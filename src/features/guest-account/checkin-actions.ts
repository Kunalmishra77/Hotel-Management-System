"use server";
/**
 * Guest online check-in (Wave 2). A guest self-completes the digital registration
 * card for THEIR OWN confirmed reservation before arrival — reusing the same
 * signature → encrypted-object-storage → RegistrationCard path as the staff desk
 * check-in. The reservation is flagged `onlineCheckInAt`; reception then confirms
 * at arrival in one tap.
 *
 * Security: the reservation is resolved from the session's guestId (never a client
 * id); a foreign, past, or already-checked-in reservation is refused. The card
 * snapshot is built server-side so a tampered payload can't forge it. Signature
 * bytes live only in encrypted storage; the row keeps a key + checksum.
 */
import { randomUUID } from "node:crypto";
import { NotFoundError, DomainError, ErrorCode } from "@/lib/errors";
import { type Result, toResult } from "@/lib/result";
import { db } from "@/lib/db";
import { runWithSystemContext } from "@/lib/context";
import { writeAudit } from "@/lib/audit";
import { emitEvent } from "@/lib/events";
import { resolveStorageAdapter } from "@/lib/storage";
import { resolveGuestSession } from "@/lib/guest-auth";
import { canOnlineCheckIn } from "./domain/online-checkin";
import { onlineCheckInSchema } from "./schema";

export type OnlineCheckInResult = { reservationId: string };

export async function submitOnlineCheckIn(raw: unknown): Promise<Result<OnlineCheckInResult>> {
  return toResult(async () => {
    const data = onlineCheckInSchema.parse(raw);

    const principal = await resolveGuestSession();
    if (!principal) throw new NotFoundError("Please sign in.");

    // The reservation MUST belong to the signed-in guest (IDOR-safe).
    const r = await db.unscoped().reservation.findFirst({
      where: { id: data.reservationId, guestId: principal.guestId },
      select: {
        id: true, propertyId: true, code: true, status: true,
        checkInDate: true, checkOutDate: true, nights: true,
        guest: { select: { fullName: true } },
        allocations: { select: { room: { select: { number: true } } } },
      },
    });
    if (!r) throw new NotFoundError("Booking not found.");
    if (!canOnlineCheckIn(r.status)) {
      throw new DomainError(ErrorCode.ILLEGAL_TRANSITION, undefined, {
        publicMessage: "Online check-in is only available for a confirmed, upcoming booking.",
      });
    }

    // Signature → encrypted object storage (PII); the row keeps only the reference.
    const bytes = Buffer.from(data.signatureBase64, "base64");
    const key = `registration-cards/${principal.orgId}/${r.id}/signature-${randomUUID()}`;
    const stored = await resolveStorageAdapter().put(key, bytes, { contentType: "image/png" });

    // Server-built snapshot of what the guest signed (no PII beyond the card need).
    const guestSnapshot = {
      guestName: r.guest.fullName,
      code: r.code,
      rooms: r.allocations.map((a) => a.room.number),
      checkInDate: r.checkInDate.toISOString().slice(0, 10),
      checkOutDate: r.checkOutDate.toISOString().slice(0, 10),
      nights: r.nights,
      expectedArrival: data.expectedArrival ?? null,
      specialRequests: data.specialRequests ?? null,
      capturedAt: new Date().toISOString(),
      source: "online",
    };

    await runWithSystemContext(principal.orgId, () =>
      db.unscoped().$transaction(async (tx) => {
        const existing = await tx.registrationCard.findFirst({ where: { reservationId: r.id }, select: { id: true } });
        if (existing) {
          await tx.registrationCard.update({
            where: { id: existing.id },
            data: { signatureObjectKey: stored.key, signatureChecksum: stored.checksum, guestSnapshot },
          });
        } else {
          await tx.registrationCard.create({
            data: {
              propertyId: r.propertyId,
              reservationId: r.id,
              signatureObjectKey: stored.key,
              signatureChecksum: stored.checksum,
              guestSnapshot,
              capturedById: null, // guest-completed, not a reception user
            },
          });
        }
        await tx.reservation.update({
          where: { id: r.id },
          data: { onlineCheckInAt: new Date(), expectedArrival: data.expectedArrival ?? undefined },
        });
        await emitEvent(tx, {
          type: "RegistrationCardCaptured",
          aggregateId: r.id,
          propertyId: r.propertyId,
          payload: { code: r.code, source: "online" },
        });
        await writeAudit(tx, {
          action: "guestaccount:online-checkin",
          entityType: "Reservation",
          entityId: r.id,
          propertyId: r.propertyId,
          after: { onlineCheckIn: true },
        });
      }),
    );

    return { reservationId: r.id };
  });
}
