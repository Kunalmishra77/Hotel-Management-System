"use server";

/**
 * Check-in artifacts — 03 T6. `saveRegistrationCard` persists the digital
 * registration card + e-signature captured during the check-in wizard. The
 * signature PNG is uploaded to ENCRYPTED object storage (PII, exactly like an ID
 * scan) — the row keeps only the object key + checksum, never the bytes. The
 * guest snapshot is built server-side from the reservation (authoritative), so a
 * tampered client payload cannot forge what the card records.
 */
import { randomUUID } from "node:crypto";
import { requireUser } from "@/lib/auth";
import { authorize } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import { emitEvent } from "@/lib/events";
import { DomainError, ErrorCode, NotFoundError } from "@/lib/errors";
import { toResult, type Result } from "@/lib/result";
import { resolveStorageAdapter } from "@/lib/storage";
import { getGuestProfile } from "@/features/guests/queries";
import { reservationDb, withReservationContext } from "./internal";
import { saveRegistrationCardSchema } from "./schema";

export type RegistrationCardSaved = { id: string; hasSignature: boolean };

export async function saveRegistrationCard(input: unknown): Promise<Result<RegistrationCardSaved>> {
  return toResult(async () => {
    const data = saveRegistrationCardSchema.parse(input);
    const user = await requireUser();
    const client = reservationDb(user);

    const r = await client.reservation.findFirst({
      where: { id: data.reservationId },
      select: {
        id: true,
        propertyId: true,
        code: true,
        status: true,
        guestId: true,
        checkInDate: true,
        checkOutDate: true,
        nights: true,
        guest: { select: { fullName: true } },
        allocations: { select: { room: { select: { number: true } } } },
      },
    });
    if (!r) throw new NotFoundError("Reservation not found.");
    authorize(user, "checkin:perform", r.propertyId);

    // Captured at check-in — before the guest is checked out.
    if (r.status !== "CONFIRMED" && r.status !== "IN_HOUSE") {
      throw new DomainError(ErrorCode.ILLEGAL_TRANSITION, "The registration card is captured during check-in.");
    }

    // Signature → encrypted object storage; DB keeps only the reference (PII).
    let signatureObjectKey: string | null = null;
    let signatureChecksum: string | null = null;
    if (data.signatureBase64) {
      const bytes = Buffer.from(data.signatureBase64, "base64");
      const key = `registration-cards/${user.orgId}/${r.id}/signature-${randomUUID()}`;
      const stored = await resolveStorageAdapter().put(key, bytes, { contentType: "image/png" });
      signatureObjectKey = stored.key;
      signatureChecksum = stored.checksum;
    }

    // Freeze what the guest signed — masked IDs only (no PII beyond the card need).
    const profile = await getGuestProfile(user, r.guestId);
    const guestSnapshot = {
      guestName: r.guest.fullName,
      code: r.code,
      rooms: r.allocations.map((a) => a.room.number),
      checkInDate: r.checkInDate.toISOString().slice(0, 10),
      checkOutDate: r.checkOutDate.toISOString().slice(0, 10),
      nights: r.nights,
      ids: (profile?.ids ?? []).map((i) => ({ type: i.type, maskedValue: i.maskedValue })),
      capturedAt: new Date().toISOString(),
    };

    return withReservationContext(user, () =>
      client.$transaction(async (tx) => {
        const existing = await tx.registrationCard.findFirst({
          where: { reservationId: r.id },
          select: { id: true },
        });

        const card = existing
          ? await tx.registrationCard.update({
              where: { id: existing.id },
              data: { signatureObjectKey, signatureChecksum, keyCardRef: data.keyCardRef ?? null, guestSnapshot },
              select: { id: true },
            })
          : await tx.registrationCard.create({
              data: {
                propertyId: r.propertyId,
                reservationId: r.id,
                signatureObjectKey,
                signatureChecksum,
                keyCardRef: data.keyCardRef ?? null,
                guestSnapshot,
                capturedById: user.userId,
              },
              select: { id: true },
            });

        await emitEvent(tx, {
          type: "RegistrationCardCaptured",
          aggregateId: r.id,
          propertyId: r.propertyId,
          payload: { code: r.code, hasSignature: signatureObjectKey !== null },
        });
        await writeAudit(tx, {
          action: "reservation:registration-card",
          entityType: "RegistrationCard",
          entityId: card.id,
          propertyId: r.propertyId,
          after: { hasSignature: signatureObjectKey !== null, keyCard: data.keyCardRef ?? null },
        });

        return { id: card.id, hasSignature: signatureObjectKey !== null };
      }),
    );
  });
}
