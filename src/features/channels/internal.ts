/**
 * Shared internals for the channels module. NOT a "use server" module.
 *
 * Holds the scoped/unscoped db accessors, the system-context wrapper for
 * inbound/worker processing, the sync-log status constants (the health view +
 * needs-attention queue read these), and the system-safe guest resolve/create
 * that inbound OTA reservations use before calling 03.
 */
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { emitEvent } from "@/lib/events";
import { writeAudit } from "@/lib/audit";
import { encryptOptional, encryptString } from "@/lib/crypto/encryption";
import { emailToken, mobileToken } from "@/features/guests/internal";
import type { SessionClaims } from "@/lib/auth/claims";

/** ChannelAccount is property-scoped — the scoped client filters it (data-model.md). */
export function channelDb(user: SessionClaims) {
  return db.scoped(user);
}

/** `ChannelSyncLog.status` values (schema stores a free String; these are the set). */
export const SyncStatus = {
  PENDING: "PENDING",
  OK: "OK",
  FAILED: "FAILED",
  DEAD_LETTER: "DEAD_LETTER",
  NEEDS_ATTENTION: "NEEDS_ATTENTION",
} as const;
export type SyncStatus = (typeof SyncStatus)[keyof typeof SyncStatus];

export const SyncDirection = { IN: "IN", OUT: "OUT" } as const;
export type SyncDirection = (typeof SyncDirection)[keyof typeof SyncDirection];

/** Alert codes surfaced to admins/reception (design § Error catalog). */
export const AlertCode = {
  OVERSELL: "CHANNEL_OVERSELL",
  MAPPING_MISSING: "channel.mapping_missing",
  DEAD_LETTER: "channel.dead_letter",
  UNKNOWN_REF: "channel.unknown_ref",
} as const;

/**
 * Resolve an existing guest by mobile (keyed hash, no scan) or create one from
 * the OTA-supplied contact (FR-6). Runs inside the caller's system-context
 * transaction. Mirrors 04's storage contract (contact encrypted, `*Hash` tokens)
 * because 04 exposes no system-context create; see the module review note.
 *
 * PII minimization (compliance.md): only name + contact are stored; the event
 * payload carries the guestId only, never PII.
 */
export async function resolveOrCreateGuest(
  tx: Prisma.TransactionClient,
  orgId: string,
  input: { fullName: string; mobile: string; email: string | null },
): Promise<string> {
  const mobileHash = mobileToken(input.mobile);
  if (mobileHash) {
    const existing = await tx.guest.findFirst({
      where: { orgId, mobileHash, deletedAt: null },
      select: { id: true },
    });
    if (existing) return existing.id;
  }

  const guest = await tx.guest.create({
    data: {
      orgId,
      fullName: input.fullName,
      // Contact stored ENCRYPTED; the *Hash columns are the keyed search tokens.
      mobile: encryptString(input.mobile),
      mobileHash,
      email: encryptOptional(input.email),
      emailHash: emailToken(input.email),
    },
    select: { id: true, fullName: true },
  });

  await emitEvent(tx, {
    type: "GuestCreated",
    aggregateId: guest.id,
    payload: { guestId: guest.id, via: "channel" },
    orgId,
  });
  await writeAudit(tx, {
    action: "guest:create",
    entityType: "Guest",
    entityId: guest.id,
    orgId,
    after: { fullName: guest.fullName, via: "channel" },
  });

  return guest.id;
}
