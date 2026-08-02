/**
 * Outbound availability/rate push — 13 T-15/T-16/T-17 (FR-9/10/12/13/18).
 *
 * The ONE availability truth stays in 03: a push recomputes the current number
 * of sellable rooms for a category/range via 03's `findFreeRooms` (the same
 * exclusion-constraint-backed inventory direct bookings use) and sends it to
 * every ACTIVE channel mapped to that category. Sandbox managers "send" to the
 * outbox (a `ChannelSyncLog` row) and no real OTA (FR-18).
 *
 * Reliability (FR-13): a push is idempotent (it sends CURRENT state), so a retry
 * is always safe. The consumer re-throws on failure to let 00's event dispatcher
 * retry with backoff and dead-letter after the cap; `deadLetterStalePushes` also
 * ages persistently-failing OUT rows to DEAD_LETTER for the health view + alert.
 * None of this runs on the request path, so the front desk is never blocked.
 */
import type { PrismaClient } from "@prisma/client";
import { runWithSystemContext } from "@/lib/context";
import { emitEvent } from "@/lib/events";
import { alertAdmin } from "@/lib/alerts";
import { logger } from "@/lib/logger";
import { findFreeRooms, type RoomFinder } from "@/features/reservations/availability";
import { resolveChannelManager } from "@/lib/channels";
import type { AvailabilityDelta } from "./domain/availability-delta";
import { classifyRetry } from "./domain/retry";
import { AlertCode, SyncDirection, SyncStatus } from "./internal";

type Db = PrismaClient;

/** Active channel accounts mapped to a category, with their external room type. */
export async function activeMappedAccounts(
  prisma: Db,
  propertyId: string,
  categoryId: string,
): Promise<
  {
    id: string;
    provider: string;
    isActive: boolean;
    certifiedAt: Date | null;
    credentialsRef: string | null;
    config: unknown;
    externalRoomType: string;
  }[]
> {
  const mappings = await prisma.roomTypeMapping.findMany({
    where: {
      roomCategoryId: categoryId,
      channelAccount: { propertyId, isActive: true },
    },
    select: {
      externalRoomType: true,
      channelAccount: {
        select: {
          id: true,
          provider: true,
          isActive: true,
          certifiedAt: true,
          credentialsRef: true,
          config: true,
        },
      },
    },
  });

  return mappings.map((m) => ({
    id: m.channelAccount.id,
    provider: m.channelAccount.provider,
    isActive: m.channelAccount.isActive,
    certifiedAt: m.channelAccount.certifiedAt,
    credentialsRef: m.channelAccount.credentialsRef,
    config: m.channelAccount.config,
    externalRoomType: m.externalRoomType,
  }));
}

/** Current sellable room count for a category/range — the single truth (03). */
export async function countAvailable(
  prisma: Db,
  propertyId: string,
  categoryId: string,
  from: Date,
  to: Date,
): Promise<number> {
  const free = await findFreeRooms(prisma as unknown as RoomFinder, {
    propertyId,
    categoryId,
    checkInDate: from,
    checkOutDate: to,
  });
  return free.length;
}

export type PushOutcome = { pushed: number; failed: number };

/**
 * Push a delta to every active mapped channel. Records a `ChannelSyncLog` per
 * account (OK/FAILED) and emits `ChannelPushed` on success. Never throws — the
 * caller decides whether a failure should trigger a dispatcher retry.
 */
export async function pushDeltaToChannels(
  prisma: Db,
  orgId: string,
  delta: AvailabilityDelta,
): Promise<PushOutcome> {
  const accounts = await activeMappedAccounts(prisma, delta.propertyId, delta.categoryId);
  if (accounts.length === 0) return { pushed: 0, failed: 0 };

  const available =
    delta.push === "availability"
      ? await countAvailable(prisma, delta.propertyId, delta.categoryId, delta.from, delta.to)
      : 0;

  let pushed = 0;
  let failed = 0;

  for (const account of accounts) {
    const manager = resolveChannelManager({
      provider: account.provider,
      isActive: account.isActive,
      certifiedAt: account.certifiedAt,
      credentialsRef: account.credentialsRef,
      config: (account.config ?? {}) as Record<string, never>,
    });

    const type = delta.push === "availability" ? "pushAvailability" : "pushRates";
    const result =
      delta.push === "availability"
        ? await manager.pushAvailability({
            propertyId: delta.propertyId,
            categoryId: delta.categoryId,
            externalRoomType: account.externalRoomType,
            from: delta.from,
            to: delta.to,
            available,
          })
        : await manager.pushRates({
            propertyId: delta.propertyId,
            categoryId: delta.categoryId,
            externalRoomType: account.externalRoomType,
            from: delta.from,
            to: delta.to,
            ratePaise: delta.ratePaise ?? 0,
          });

    await runWithSystemContext(orgId, () =>
      prisma.$transaction(async (tx) => {
        await tx.channelSyncLog.create({
          data: {
            channelAccountId: account.id,
            direction: SyncDirection.OUT,
            type,
            status: result.ok ? SyncStatus.OK : SyncStatus.FAILED,
            // OUT rows carry the target category in externalId (no OTA id here).
            externalId: delta.categoryId,
            error: result.ok ? null : result.error.slice(0, 500),
          },
        });
        if (result.ok) {
          await tx.channelAccount.updateMany({
            where: { id: account.id },
            data: { lastSyncAt: new Date() },
          });
          await emitEvent(tx, {
            type: "ChannelPushed",
            aggregateId: account.id,
            propertyId: delta.propertyId,
            payload: { type, categoryId: delta.categoryId, available, ref: result.ref },
            orgId,
          });
        }
      }),
    );

    if (result.ok) pushed += 1;
    else {
      failed += 1;
      logger.warn("channel.push_failed", { accountId: account.id, type, error: result.error });
    }
  }

  return { pushed, failed };
}

/**
 * Age persistently-failing OUT pushes to DEAD_LETTER and alert an admin (FR-13).
 * A row that has been FAILED longer than the retry window is given up on — the
 * front desk was never blocked, and the channel is flagged for operator repair.
 */
export async function deadLetterStalePushes(
  prisma: Db,
  now: Date = new Date(),
): Promise<{ deadLettered: number }> {
  const failing = await prisma.channelSyncLog.findMany({
    where: { direction: SyncDirection.OUT, status: SyncStatus.FAILED },
    select: { id: true, channelAccountId: true, type: true, createdAt: true },
    take: 500,
  });

  let deadLettered = 0;
  for (const row of failing) {
    if (classifyRetry(row.createdAt, now) !== "DEAD_LETTER") continue;
    await prisma.channelSyncLog.updateMany({
      where: { id: row.id, status: SyncStatus.FAILED },
      data: { status: SyncStatus.DEAD_LETTER },
    });
    deadLettered += 1;
    await alertAdmin({
      severity: "critical",
      code: AlertCode.DEAD_LETTER,
      title: `Channel push dead-lettered (${row.type})`,
      detail: { channelAccountId: row.channelAccountId, type: row.type },
    });
  }
  return { deadLettered };
}
