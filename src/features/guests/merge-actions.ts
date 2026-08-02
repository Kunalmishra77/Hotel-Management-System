"use server";

/**
 * Guest merge — 04 T-11 (FR-12, AC-11).
 *
 * Two confirmed duplicates become one. Under `guest:merge` (🔒, audited):
 * choose a survivor, combine fields by the deterministic rule, re-point every
 * reference (Reservation, Feedback, GuestId) to the survivor, set the loser's
 * `mergedIntoId` + soft-delete it, and emit `GuestMerged` (05 recomputes BOTH).
 * Atomic — a half-merged guest would lose stay history.
 */
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { authorize } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import { emitEvent } from "@/lib/events";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { toResult, type Result } from "@/lib/result";
import { mergeFields, type MergeableFields } from "./domain/dedupe";
import { mergeGuestsSchema } from "./schema";
import { guestDb, mobileToken, emailToken, withGuestContext } from "./internal";
import { decryptOptional, encryptOptional } from "@/lib/crypto/encryption";

export type MergeResult = { survivorId: string; loserId: string; repointed: number };

export async function mergeGuests(input: unknown): Promise<Result<MergeResult>> {
  return toResult(async () => {
    const data = mergeGuestsSchema.parse(input);
    const user = await requireUser();
    authorize(user, "guest:merge", null, { reason: data.reason ?? "Confirmed duplicate merge" });

    const prisma = guestDb();

    return withGuestContext(user, () =>
      prisma.$transaction(async (tx) => {
        const [survivor, loser] = await Promise.all([
          tx.guest.findFirst({
            where: { id: data.survivorId, orgId: user.orgId, deletedAt: null },
            select: MERGE_SELECT,
          }),
          tx.guest.findFirst({
            where: { id: data.loserId, orgId: user.orgId, deletedAt: null },
            select: MERGE_SELECT,
          }),
        ]);
        if (!survivor) throw new NotFoundError("Survivor guest not found");
        if (!loser) throw new NotFoundError("Loser guest not found");
        if (loser.mergedIntoId) {
          throw new ConflictError("That guest has already been merged.");
        }

        // Deterministic field combination. Contact is compared/merged on the
        // DECRYPTED values, then re-encrypted, so the survivor keeps a real
        // token for search.
        const survivorFields = toMergeable(survivor);
        const loserFields = toMergeable(loser);
        const merged = mergeFields(survivorFields, loserFields);

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
            // The survivor keeps its own mobile/mobileHash; if it had none, take
            // the loser's so search still finds the merged guest.
            ...(decryptOptional(survivor.mobile) === null && decryptOptional(loser.mobile) !== null
              ? {
                  mobile: loser.mobile,
                  mobileHash: mobileToken(decryptOptional(loser.mobile)),
                }
              : {}),
          },
        });

        // Re-point every reference the loser owns.
        const [reservations, feedback, ids] = await Promise.all([
          tx.reservation.updateMany({
            where: { guestId: loser.id },
            data: { guestId: survivor.id },
          }),
          tx.feedback.updateMany({
            where: { guestId: loser.id },
            data: { guestId: survivor.id },
          }),
          tx.guestId.updateMany({
            where: { guestId: loser.id },
            data: { guestId: survivor.id },
          }),
        ]);
        const repointed = reservations.count + feedback.count + ids.count;

        // Mark lineage + soft-delete the loser.
        await tx.guest.update({
          where: { id: loser.id },
          data: { mergedIntoId: survivor.id, deletedAt: new Date() },
        });

        // 05 recomputes BOTH — the survivor gains the loser's stays, the loser
        // is now empty.
        await emitEvent(tx, {
          type: "GuestMerged",
          aggregateId: survivor.id,
          payload: { survivorId: survivor.id, loserId: loser.id },
        });
        await writeAudit(tx, {
          action: "guest:merge",
          entityType: "Guest",
          entityId: survivor.id,
          reason: data.reason ?? null,
          before: { loserId: loser.id },
          after: { survivorId: survivor.id, repointed },
        });

        revalidatePath("/guests");
        return { survivorId: survivor.id, loserId: loser.id, repointed };
      }),
    );
  });
}

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

type MergeRow = {
  fullName: string;
  email: string | null;
  whatsapp: string | null;
  city: string | null;
  foodPreference: string | null;
  specialRequests: string | null;
};

/** Decrypt contact for comparison; other fields are plaintext. */
function toMergeable(row: {
  fullName: string;
  email: string | null;
  whatsapp: string | null;
  city: string | null;
  foodPreference: string | null;
  specialRequests: string | null;
}): MergeableFields {
  return {
    fullName: row.fullName,
    email: decryptOptional(row.email),
    whatsapp: decryptOptional(row.whatsapp),
    city: row.city,
    foodPreference: row.foodPreference,
    specialRequests: row.specialRequests,
  } satisfies MergeRow;
}
