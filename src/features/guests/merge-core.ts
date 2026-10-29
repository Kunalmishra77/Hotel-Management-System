/**
 * The guest-merge transaction body — shared by the `mergeGuests` action (staff
 * merge button) and the one-off duplicate cleanup script, so both move exactly
 * the same data. NOT a "use server" module.
 *
 * Re-points EVERY table that references a guest. The original merge moved only
 * reservations, feedback and IDs; C-Forms, add-on requests, messages, requests,
 * coupon redemptions, accounts and message logs stayed on the soft-deleted loser
 * and silently dropped out of the surviving guest's history.
 */
import type { Prisma } from "@prisma/client";
import { writeAudit } from "@/lib/audit";
import { emitEvent } from "@/lib/events";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { decryptOptional, encryptOptional } from "@/lib/crypto/encryption";
import { mergeFields } from "./domain/dedupe";
import { emailToken, mobileToken } from "./internal";

const MERGE_SELECT = {
  id: true,
  fullName: true,
  mobile: true,
  email: true,
  whatsapp: true,
  city: true,
  foodPreference: true,
  specialRequests: true,
  mergedIntoId: true,
} as const;

/** Move everything the loser owns onto the survivor. Returns rows re-pointed. */
async function repointGuestReferences(tx: Prisma.TransactionClient, loserId: string, survivorId: string): Promise<number> {
  const move = { where: { guestId: loserId }, data: { guestId: survivorId } };
  const counts = await Promise.all([
    tx.reservation.updateMany(move),
    tx.feedback.updateMany(move),
    tx.guestId.updateMany(move),
    tx.addOnRequest.updateMany(move),
    tx.cForm.updateMany(move),
    tx.couponRedemption.updateMany(move),
    tx.guestAccount.updateMany(move),
    tx.guestMessage.updateMany(move),
    tx.guestRequest.updateMany(move),
    tx.messageLog.updateMany(move),
  ]);
  // Consent is unique per (guest, channel): the survivor's own choice wins for a
  // channel it already has; the loser's is kept only for channels it lacks.
  const survivorChannels = new Set(
    (await tx.communicationConsent.findMany({ where: { guestId: survivorId }, select: { channel: true } })).map((c) => c.channel),
  );
  const loserConsents = await tx.communicationConsent.findMany({ where: { guestId: loserId }, select: { id: true, channel: true } });
  for (const c of loserConsents) {
    if (survivorChannels.has(c.channel)) await tx.communicationConsent.delete({ where: { id: c.id } });
    else await tx.communicationConsent.update({ where: { id: c.id }, data: { guestId: survivorId } });
  }
  return counts.reduce((n, r) => n + r.count, 0) + loserConsents.length;
}

/**
 * Merge `loserId` into `survivorId` inside the caller's transaction: combine
 * fields (contact compared decrypted, re-encrypted), re-point every reference,
 * soft-delete the loser with `mergedIntoId` lineage, emit `GuestMerged` (05
 * recomputes both) and audit. Caller provides authz + context.
 */
export async function mergeGuestPairTx(
  tx: Prisma.TransactionClient,
  input: { orgId: string; survivorId: string; loserId: string; reason: string | null },
): Promise<{ survivorId: string; loserId: string; repointed: number }> {
  if (input.survivorId === input.loserId) throw new ConflictError("Can't merge a guest into itself.");
  const [survivor, loser] = await Promise.all([
    tx.guest.findFirst({ where: { id: input.survivorId, orgId: input.orgId, deletedAt: null }, select: MERGE_SELECT }),
    tx.guest.findFirst({ where: { id: input.loserId, orgId: input.orgId, deletedAt: null }, select: MERGE_SELECT }),
  ]);
  if (!survivor) throw new NotFoundError("Survivor guest not found");
  if (!loser) throw new NotFoundError("Loser guest not found");
  if (loser.mergedIntoId) throw new ConflictError("That guest has already been merged.");

  const merged = mergeFields(
    { fullName: survivor.fullName, email: decryptOptional(survivor.email), whatsapp: decryptOptional(survivor.whatsapp), city: survivor.city, foodPreference: survivor.foodPreference, specialRequests: survivor.specialRequests },
    { fullName: loser.fullName, email: decryptOptional(loser.email), whatsapp: decryptOptional(loser.whatsapp), city: loser.city, foodPreference: loser.foodPreference, specialRequests: loser.specialRequests },
  );
  await tx.guest.update({
    where: { id: survivor.id },
    data: {
      fullName: merged.fullName ?? survivor.fullName,
      email: encryptOptional(merged.email),
      emailHash: emailToken(merged.email),
      whatsapp: encryptOptional(merged.whatsapp),
      city: merged.city,
      foodPreference: merged.foodPreference,
      specialRequests: merged.specialRequests,
      // The survivor keeps its own mobile; if it had none, take the loser's so
      // search still finds the merged guest.
      ...(decryptOptional(survivor.mobile) === null && decryptOptional(loser.mobile) !== null
        ? { mobile: loser.mobile, mobileHash: mobileToken(decryptOptional(loser.mobile)) }
        : {}),
    },
  });

  const repointed = await repointGuestReferences(tx, loser.id, survivor.id);
  await tx.guest.update({ where: { id: loser.id }, data: { mergedIntoId: survivor.id, deletedAt: new Date() } });
  await emitEvent(tx, { type: "GuestMerged", aggregateId: survivor.id, payload: { survivorId: survivor.id, loserId: loser.id } });
  await writeAudit(tx, {
    action: "guest:merge",
    entityType: "Guest",
    entityId: survivor.id,
    reason: input.reason,
    before: { loserId: loser.id },
    after: { survivorId: survivor.id, repointed },
  });
  return { survivorId: survivor.id, loserId: loser.id, repointed };
}
