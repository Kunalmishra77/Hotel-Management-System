"use server";
/**
 * Guest add-on / upsell request (Wave 3). A signed-in guest requests a paid extra
 * (airport pickup, extra bed, breakfast, early check-in, late checkout) against
 * THEIR OWN upcoming/in-house booking. Nothing is charged here — the request is
 * pending until reception accepts it (settle-to-folio), mirroring the POS guest-QR
 * "submit → staff-accept" gate.
 *
 * Security: the reservation is resolved from the session's guestId (never a client
 * id) and must be CONFIRMED/IN_HOUSE. The catalog item is loaded through the
 * add-ons query layer and must belong to the SAME property + be active; name,
 * price and charge type are snapshotted so a later catalog edit can't rewrite a
 * placed request or its eventual charge.
 */
import { NotFoundError, DomainError, ErrorCode } from "@/lib/errors";
import { type Result, toResult } from "@/lib/result";
import { db } from "@/lib/db";
import { runWithSystemContext } from "@/lib/context";
import { writeAudit } from "@/lib/audit";
import { emitEvent } from "@/lib/events";
import { resolveGuestSession } from "@/lib/guest-auth";
import { getAddOn } from "@/features/add-ons/queries";
import { canRequestAddOn } from "@/features/add-ons/domain/upsell";
import { requestAddOnSchema } from "./schema";

export type RequestAddOnResult = { requestId: string };

export async function requestAddOn(raw: unknown): Promise<Result<RequestAddOnResult>> {
  return toResult(async () => {
    const data = requestAddOnSchema.parse(raw);

    const principal = await resolveGuestSession();
    if (!principal) throw new NotFoundError("Please sign in.");

    // The booking MUST belong to the signed-in guest (IDOR-safe).
    const r = await db.unscoped().reservation.findFirst({
      where: { id: data.reservationId, guestId: principal.guestId },
      select: { id: true, propertyId: true, status: true },
    });
    if (!r) throw new NotFoundError("Booking not found.");
    if (!canRequestAddOn(r.status)) {
      throw new DomainError(ErrorCode.ILLEGAL_TRANSITION, undefined, {
        publicMessage: "Extras can be added to a confirmed or in-house booking only.",
      });
    }

    // The catalog item must be for this booking's property and currently offered.
    const addOn = await getAddOn(data.addOnId);
    if (!addOn || addOn.propertyId !== r.propertyId || !addOn.active) {
      throw new NotFoundError("That extra isn't available for this booking.");
    }

    const requestId = await runWithSystemContext(principal.orgId, () =>
      db.unscoped().$transaction(async (tx) => {
        const row = await tx.addOnRequest.create({
          data: {
            orgId: principal.orgId,
            propertyId: r.propertyId,
            reservationId: r.id,
            guestId: principal.guestId,
            addOnId: addOn.id,
            nameSnapshot: addOn.name,
            unitPaise: addOn.pricePaise,
            quantity: data.quantity,
            chargeType: addOn.chargeType as never,
            note: data.note ?? null,
          },
          select: { id: true },
        });
        await writeAudit(tx, {
          action: "addon:request",
          entityType: "AddOnRequest",
          entityId: row.id,
          propertyId: r.propertyId,
          after: { addOn: addOn.name, quantity: data.quantity },
        });
        await emitEvent(tx, {
          type: "AddOnRequested",
          aggregateId: row.id,
          propertyId: r.propertyId,
          payload: { reservationId: r.id, addOn: addOn.name, quantity: data.quantity },
        });
        return row.id;
      }),
    );

    return { requestId };
  });
}
