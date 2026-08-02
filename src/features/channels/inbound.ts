/**
 * Inbound OTA reservation processing — 13 T-10..T-16 (FR-5/6/7/8/12/15).
 *
 * Called by the worker's inbox sweep (exactly-once, per `processInbox`). For each
 * deduped inbox row: normalize → resolve the channel account → map the room type
 * → resolve/create the guest (04) → create/modify/cancel via 03 (the ONE
 * availability truth) → record health/needs-attention → emit → ack.
 *
 * Failure policy: a PERMANENT failure (unmapped type, unknown channelRef, garbled
 * payload) is DEAD-LETTERED — the handler returns normally so `processInbox`
 * keeps the row claimed (never reprocessed) and an admin is alerted, never
 * crashing the sweep (FR-7/13). A TRANSIENT failure (DB error) throws, so the
 * claim is released and the row retried. A paid booking is NEVER dropped (FR-12).
 */
import type { IntegrationInbox, PrismaClient } from "@prisma/client";
import { runWithSystemContext } from "@/lib/context";
import { emitEvent } from "@/lib/events";
import { writeAudit } from "@/lib/audit";
import { alertAdmin } from "@/lib/alerts";
import { logger } from "@/lib/logger";
import { createFromChannel } from "@/features/reservations/channel-actions";
import { resolveChannelManager } from "@/lib/channels";
import { normalizeInbound, NormalizeError } from "./domain/normalize";
import { mapRoomType, type RoomTypeMappingRow } from "./domain/map-room-type";
import type { CanonicalReservation } from "./domain/source-map";
import { pushDeltaToChannels } from "./outbound";
import { applyChannelModify, applyChannelCancel, toUtcDate } from "./inbound-lifecycle";
import { AlertCode, SyncDirection, SyncStatus, resolveOrCreateGuest } from "./internal";

type Db = PrismaClient;

type LoadedAccount = {
  id: string;
  provider: string;
  isActive: boolean;
  certifiedAt: Date | null;
  credentialsRef: string | null;
  config: unknown;
  orgId: string;
  mappings: RoomTypeMappingRow[];
};

async function loadAccount(prisma: Db, canonical: CanonicalReservation): Promise<LoadedAccount | null> {
  const account = await prisma.channelAccount.findFirst({
    where: { propertyId: canonical.propertyId, provider: canonical.provider },
    select: {
      id: true,
      provider: true,
      isActive: true,
      certifiedAt: true,
      credentialsRef: true,
      config: true,
      mappings: { select: { externalRoomType: true, roomCategoryId: true, externalRatePlan: true } },
    },
  });
  if (!account) return null;
  const property = await prisma.property.findUnique({
    where: { id: canonical.propertyId },
    select: { orgId: true },
  });
  if (!property) return null;
  return { ...account, orgId: property.orgId, mappings: account.mappings };
}

async function writeSyncLog(
  prisma: Db,
  input: {
    channelAccountId: string;
    direction: string;
    type: string;
    status: string;
    externalId: string | null;
    error?: string | null;
  },
): Promise<void> {
  await prisma.channelSyncLog.create({
    data: {
      channelAccountId: input.channelAccountId,
      direction: input.direction,
      type: input.type,
      status: input.status,
      externalId: input.externalId,
      error: input.error ?? null,
    },
  });
}

/** Re-push corrected availability for the reservation's category/range (FR-9/12). */
async function repushAvailability(
  prisma: Db,
  orgId: string,
  canonical: CanonicalReservation,
  categoryId: string,
): Promise<void> {
  await pushDeltaToChannels(prisma, orgId, {
    push: "availability",
    propertyId: canonical.propertyId,
    categoryId,
    from: toUtcDate(canonical.checkInDate),
    to: toUtcDate(canonical.checkOutDate),
    ratePaise: null,
  });
}

/** Process one inbound reservation message. Returns the reservation id when created. */
export async function processInboundReservation(
  prisma: Db,
  row: IntegrationInbox,
): Promise<{ reservationId: string | null; outcome: string }> {
  let canonical: CanonicalReservation;
  try {
    canonical = normalizeInbound(row.provider, row.type, row.payload);
  } catch (e) {
    if (e instanceof NormalizeError) {
      // Garbled payload — dead-letter (return, don't retry) + alert.
      logger.error("channel.normalize_failed", { provider: row.provider, error: e.message });
      await alertAdmin({
        severity: "warning",
        code: AlertCode.MAPPING_MISSING,
        title: "Unparseable inbound OTA message dead-lettered",
        detail: { provider: row.provider, externalId: row.externalId },
      });
      return { reservationId: null, outcome: "DEAD_LETTER_NORMALIZE" };
    }
    throw e; // unexpected — let the sweep retry
  }

  const account = await loadAccount(prisma, canonical);
  if (!account) {
    logger.error("channel.account_missing", { provider: canonical.provider, propertyId: canonical.propertyId });
    await alertAdmin({
      severity: "warning",
      code: AlertCode.UNKNOWN_REF,
      title: "Inbound OTA message for an unknown channel account",
      detail: { provider: canonical.provider, propertyId: canonical.propertyId, externalId: canonical.externalId },
    });
    return { reservationId: null, outcome: "DEAD_LETTER_NO_ACCOUNT" };
  }

  const manager = resolveChannelManager({
    provider: account.provider,
    isActive: account.isActive,
    certifiedAt: account.certifiedAt,
    credentialsRef: account.credentialsRef,
    config: (account.config ?? {}) as Record<string, never>,
  });

  if (canonical.messageType === "MODIFY") {
    const res = await applyChannelModify(prisma, account, canonical);
    if (res.applied) {
      await manager.ack(canonical.externalId);
      if (res.categoryId) await repushAvailability(prisma, account.orgId, canonical, res.categoryId);
    }
    return { reservationId: res.reservationId, outcome: res.outcome };
  }

  if (canonical.messageType === "CANCEL") {
    const res = await applyChannelCancel(prisma, account, canonical);
    if (res.applied) {
      await manager.ack(canonical.externalId);
      if (res.categoryId) await repushAvailability(prisma, account.orgId, canonical, res.categoryId);
    }
    return { reservationId: res.reservationId, outcome: res.outcome };
  }

  // ---- NEW reservation ----------------------------------------------------
  const categoryId = mapRoomType(account.mappings, canonical.externalRoomType);
  if (!categoryId) {
    // FR-7 / AC-6: no mapping ⇒ do NOT create; dead-letter + alert.
    await writeSyncLog(prisma, {
      channelAccountId: account.id,
      direction: SyncDirection.IN,
      type: "reservation.new",
      status: SyncStatus.DEAD_LETTER,
      externalId: canonical.externalId,
      error: "MAPPING_MISSING",
    });
    await alertAdmin({
      severity: "warning",
      code: AlertCode.MAPPING_MISSING,
      title: `Unmapped OTA room type "${canonical.externalRoomType}" — booking held for review`,
      detail: { provider: account.provider, externalRoomType: canonical.externalRoomType, externalId: canonical.externalId },
    });
    return { reservationId: null, outcome: "DEAD_LETTER_MAPPING_MISSING" };
  }

  const guestId = await runWithSystemContext(account.orgId, () =>
    prisma.$transaction((tx) =>
      resolveOrCreateGuest(tx, account.orgId, {
        fullName: canonical.guest.fullName,
        mobile: canonical.guest.mobile,
        email: canonical.guest.email,
      }),
    ),
  );

  // 03 owns the availability transaction; it NEVER drops a paid booking, and
  // returns needsAttention='OVERSELL' if no room is free (sync-lag oversell).
  const created = await createFromChannel({
    propertyId: canonical.propertyId,
    guestId,
    source: canonical.source,
    channelRef: canonical.externalId,
    channelAccountId: account.id,
    categoryId,
    roomIds: [],
    checkInDate: canonical.checkInDate,
    checkOutDate: canonical.checkOutDate,
    adults: canonical.adults,
    children: canonical.children,
    ratePaise: canonical.ratePaise,
    taxPaise: canonical.taxPaise,
    extraBedPaise: canonical.extraBedPaise,
    otherChargesPaise: canonical.otherChargesPaise,
    discountPaise: canonical.discountPaise,
    advancePaise: canonical.advancePaise,
  });

  const oversell = created.needsAttention === "OVERSELL";

  await runWithSystemContext(account.orgId, () =>
    prisma.$transaction(async (tx) => {
      await tx.channelSyncLog.create({
        data: {
          channelAccountId: account.id,
          direction: SyncDirection.IN,
          type: "reservation.new",
          status: oversell ? SyncStatus.NEEDS_ATTENTION : SyncStatus.OK,
          externalId: canonical.externalId,
          error: oversell ? "OVERSELL" : null,
        },
      });
      await emitEvent(tx, {
        type: "ChannelReservationPulled",
        aggregateId: created.id,
        propertyId: canonical.propertyId,
        payload: { externalId: canonical.externalId, reservationId: created.id, provider: account.provider },
        orgId: account.orgId,
      });
      if (oversell) {
        await emitEvent(tx, {
          type: "ChannelOversellDetected",
          aggregateId: created.id,
          propertyId: canonical.propertyId,
          payload: { externalId: canonical.externalId, categoryId },
          orgId: account.orgId,
        });
      }
      await writeAudit(tx, {
        action: "channel:reservation-pulled",
        entityType: "Reservation",
        entityId: created.id,
        propertyId: canonical.propertyId,
        orgId: account.orgId,
        after: { externalId: canonical.externalId, source: canonical.source, needsAttention: created.needsAttention },
      });
      await tx.channelAccount.updateMany({ where: { id: account.id }, data: { lastSyncAt: new Date() } });
    }),
  );

  if (oversell) {
    // FR-12: alert reception, then re-push corrected availability so the channel
    // stops selling the exhausted category. Never drop the paid booking.
    await alertAdmin({
      severity: "warning",
      code: AlertCode.OVERSELL,
      title: `Channel oversell — ${canonical.externalId} needs a room`,
      detail: { provider: account.provider, externalId: canonical.externalId, categoryId, reservationId: created.id },
    });
    await repushAvailability(prisma, account.orgId, canonical, categoryId);
  }

  // ack so the channel does not re-send (FR-15).
  await manager.ack(canonical.externalId);

  return { reservationId: created.id, outcome: oversell ? "CREATED_OVERSELL" : "CREATED" };
}

/**
 * The provider → inbox-handler map the worker registers with `processInbox`.
 * A single handler serves every channel provider (dispatch is by message type).
 */
export function channelInboxHandlers(prisma: Db): Record<string, (row: IntegrationInbox) => Promise<void>> {
  const handle = async (row: IntegrationInbox): Promise<void> => {
    await processInboundReservation(prisma, row);
  };
  // "*" catches any provider — see inbox.ts handler resolution.
  return { "*": handle };
}
