"use server";

/**
 * Historical stay import (go-live data entry). The client is entering PAST stays
 * for each property so their guest history, occupancy and revenue are complete
 * from day one. This creates, in one audited transaction, a CHECKED_OUT
 * reservation + folio + per-night room charge (+ optional payment) tied to the
 * chosen property and dates — the same money path as check-out, so the stay flows
 * everywhere (guest 360, billing, reports) exactly like a live one.
 *
 * It does NOT run the live availability engine (these are past dates): it picks a
 * room that is free for the range and allocates it for occupancy; if none is free
 * the stay is still recorded (dates + folio) without a hard allocation.
 */
import { requireUser } from "@/lib/auth";
import { authorize } from "@/lib/permissions";
import { emitEvent } from "@/lib/events";
import { writeAudit } from "@/lib/audit";
import { DomainError, ErrorCode, NotFoundError } from "@/lib/errors";
import { toResult, type Result } from "@/lib/result";
import { revalidatePath } from "next/cache";
import { ensureFolio, postRoomChargeTx, postPaymentTx, type BillingPostTx } from "@/features/billing";
import { createGuest } from "@/features/guests/actions";
import { addGuestId } from "@/features/guests/id-actions";
import { reservationDb, withReservationContext, generateReservationCode, overlapWhere } from "./internal";
import { historicalStaySchema } from "./schema";

const at = (date: Date, hour: number) => new Date(date.getTime() + hour * 3_600_000);

export async function createHistoricalStay(input: unknown): Promise<Result<{ reservationId: string; guestId: string }>> {
  return toResult(async () => {
    const data = historicalStaySchema.parse(input);
    const user = await requireUser();
    authorize(user, "reservation:create", data.propertyId);

    const property = await reservationDb(user).property.findFirst({
      where: { id: data.propertyId, deletedAt: null },
      select: { id: true, state: true },
    });
    if (!property) throw new NotFoundError("Property not found.");

    // 1. Guest — reuse the audited create (lenient dedupe for a bulk backfill).
    const guest = await createGuest({
      fullName: data.fullName,
      mobile: data.mobile,
      addressLine: data.address ?? undefined,
      city: data.city ?? undefined,
      country: data.country ?? undefined,
      dob: data.dob ?? undefined,
      confirmDuplicate: true,
    });
    if (!guest.ok) throw new DomainError(ErrorCode.VALIDATION_FAILED, guest.error.message, { publicMessage: guest.error.message });
    const guestId = guest.data.id;

    // 2. Optional ID document/number.
    if (data.idType && (data.idNumber || data.scanBase64)) {
      await addGuestId({
        guestId,
        type: data.idType,
        value: data.idNumber ?? undefined,
        scanBase64: data.scanBase64 ?? undefined,
        scanContentType: data.scanContentType ?? undefined,
      });
    }

    // 3. Dates → nights.
    const ci = new Date(`${data.checkInDate}T00:00:00.000Z`);
    const co = new Date(`${data.checkOutDate}T00:00:00.000Z`);
    const dayMs = 86_400_000;
    const nights = Math.max(1, Math.round((co.getTime() - ci.getTime()) / dayMs));
    const nightDates: Date[] = [];
    for (let i = 0; i < nights; i++) nightDates.push(new Date(ci.getTime() + i * dayMs));
    const ratePaise = data.ratePaise ?? 0;
    const amountPaid = data.amountPaidPaise ?? 0;

    // 4. A room free for the whole range (for occupancy). None free → no hard
    //    allocation, but the stay is still recorded.
    const freeRoom = await reservationDb(user).room.findFirst({
      where: { propertyId: data.propertyId, isActive: true, allocations: { none: overlapWhere(ci, co) } },
      select: { id: true, number: true },
    });

    const code = generateReservationCode();

    const result = await withReservationContext(user, () =>
      reservationDb(user).$transaction(async (tx) => {
        const reservation = await tx.reservation.create({
          data: {
            propertyId: data.propertyId,
            code,
            guestId,
            status: "CHECKED_OUT",
            source: "DIRECT",
            settlementIntent: amountPaid > 0 ? "ALREADY_PAID" : "PAY_AT_HOTEL",
            checkInDate: ci,
            checkOutDate: co,
            checkInAt: at(ci, 14),
            checkOutAt: at(co, 11),
            nights,
            adults: 1,
            children: 0,
            ratePaise,
            taxPaise: 0, // the folio carries the authoritative tax
            advancePaise: 0,
          },
          select: { id: true },
        });

        if (freeRoom) {
          await tx.roomAllocation.create({
            data: { propertyId: data.propertyId, reservationId: reservation.id, roomId: freeRoom.id, startDate: ci, endDate: co },
          });
        }

        // Folio + one ROOM line per night (GST from the tariff band) + payment.
        if (ratePaise > 0 || amountPaid > 0) {
          const folioId = await ensureFolio(tx, { reservationId: reservation.id, propertyId: data.propertyId });
          if (ratePaise > 0) {
            for (const businessDate of nightDates) {
              await postRoomChargeTx(tx as unknown as BillingPostTx, {
                folioId,
                propertyId: data.propertyId,
                propertyState: property.state,
                ratePaise,
                businessDate,
                postedById: user.userId,
                description: `Room ${freeRoom?.number ?? ""} · night (historical)`.trim(),
              });
            }
          }
          if (amountPaid > 0) {
            await postPaymentTx(tx as unknown as BillingPostTx, {
              folioId,
              propertyId: data.propertyId,
              mode: "CASH",
              amountPaise: amountPaid,
              reference: `HIST-${code}`,
              receivedById: user.userId,
            });
          }
        }

        await emitEvent(tx, {
          type: "ReservationCreated",
          aggregateId: reservation.id,
          propertyId: data.propertyId,
          payload: { code, historical: true },
        });
        await writeAudit(tx, {
          action: "reservation:historical-import",
          entityType: "Reservation",
          entityId: reservation.id,
          propertyId: data.propertyId,
          after: { code, guestId, checkInDate: data.checkInDate, checkOutDate: data.checkOutDate, nights },
        });
        return { reservationId: reservation.id, guestId };
      }),
    );

    revalidatePath("/guests");
    revalidatePath("/bookings");
    return result;
  });
}
