"use server";

/**
 * Shorten an in-house stay (client, 15 Nov 2026): a guest booked for a month
 * says after check-in "I'm leaving in 5 days". Moving the check-out EARLIER now
 * — not when they finally leave — frees the room for the nights they won't use,
 * so it shows as available and can be sold.
 *
 * What changes, all in one transaction:
 *  - the booking's check-out + nights;
 *  - the room allocation(s) are cut to the new date (a planned later room
 *    segment is removed) — the same plan early check-out uses;
 *  - the nights from the new check-out on, billed in full at check-in, are
 *    REVERSED on the folio (append-only, never deleted);
 *  - extension records past the new date are trimmed so revenue-by-source stays right.
 * The guest stays IN_HOUSE; check-out is still pressed on the day they leave.
 */
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { authorize } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import { emitEvent } from "@/lib/events";
import { DomainError, ErrorCode, NotFoundError } from "@/lib/errors";
import { toResult, type Result } from "@/lib/result";
import { earlyCheckoutPlan } from "./domain/allocations";
import { nights as computeNights } from "./domain/nights";
import { reservationDb, withReservationContext } from "./internal";

const shortenStaySchema = z.object({
  reservationId: z.string().min(1),
  /** New check-out, YYYY-MM-DD (property-local business date). */
  newCheckOutDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const DAY = 86_400_000;

export async function shortenStay(input: unknown): Promise<Result<{ id: string; checkOutDate: string; nights: number; reversedNights: number }>> {
  return toResult(async () => {
    const data = shortenStaySchema.parse(input);
    const user = await requireUser();
    const client = reservationDb(user);
    const r = await client.reservation.findFirst({
      where: { id: data.reservationId },
      select: {
        id: true, propertyId: true, status: true, checkInDate: true, checkOutDate: true, nights: true,
        allocations: { select: { id: true, roomId: true, startDate: true, endDate: true } },
        folio: { select: { id: true } },
        property: { select: { timezone: true } },
      },
    });
    if (!r) throw new NotFoundError("Reservation not found.");
    authorize(user, "reservation:modify", r.propertyId);
    if (r.status !== "IN_HOUSE") {
      throw new DomainError(ErrorCode.ILLEGAL_TRANSITION, "Only an in-house stay can be shortened here.", {
        publicMessage: "Only a guest who is checked in can have the check-out moved earlier here. For a future booking use Edit dates.",
      });
    }

    const newCheckOut = new Date(`${data.newCheckOutDate}T00:00:00.000Z`);
    const tz = r.property.timezone || "Asia/Kolkata";
    const today = new Date(`${new Date().toLocaleDateString("en-CA", { timeZone: tz })}T00:00:00.000Z`);
    const minOut = new Date(Math.max(today.getTime(), r.checkInDate.getTime() + DAY));
    if (newCheckOut.getTime() >= r.checkOutDate.getTime()) {
      throw new DomainError(ErrorCode.VALIDATION_FAILED, "New check-out must be earlier.", {
        publicMessage: "The new check-out must be earlier than the current one. To make the stay longer use Extend stay.",
      });
    }
    if (newCheckOut.getTime() < minOut.getTime()) {
      throw new DomainError(ErrorCode.VALIDATION_FAILED, "New check-out is in the past.", {
        publicMessage: "The new check-out can't be before today (or before the first night). If the guest is leaving now, press Check out.",
      });
    }
    const nights = computeNights(r.checkInDate, newCheckOut, tz);
    const plan = earlyCheckoutPlan(r.allocations, newCheckOut);

    const result = await withReservationContext(user, () =>
      client.$transaction(async (tx) => {
        // Same CAS idea as check-out: only act if the stay is still as we read it.
        const moved = await tx.reservation.updateMany({
          where: { id: r.id, status: "IN_HOUSE", checkOutDate: r.checkOutDate },
          data: { checkOutDate: newCheckOut, nights },
        });
        if (moved.count !== 1) throw new DomainError(ErrorCode.CONFLICT, "This booking changed meanwhile — reload and try again.");

        if (plan.shorten.length) await tx.roomAllocation.updateMany({ where: { id: { in: plan.shorten.map((a) => a.id) } }, data: { endDate: newCheckOut } });
        if (plan.remove.length) await tx.roomAllocation.deleteMany({ where: { id: { in: plan.remove.map((a) => a.id) } } });

        // Nights the guest will no longer stay were billed at check-in → reverse them.
        let reversedNights = 0;
        if (r.folio) {
          await tx.$executeRaw`SELECT id FROM "Folio" WHERE id = ${r.folio.id} FOR UPDATE`;
          const reversedOf = new Set(
            (await tx.folioLine.findMany({ where: { folioId: r.folio.id, type: "REVERSAL" }, select: { reversalOfId: true } }))
              .map((l) => l.reversalOfId).filter((id): id is string => id !== null),
          );
          const unused = (await tx.folioLine.findMany({
            where: { folioId: r.folio.id, type: "ROOM", businessDate: { gte: newCheckOut } },
            select: { id: true, description: true, unitPaise: true, amountPaise: true, taxRateBps: true, cgstPaise: true, sgstPaise: true, igstPaise: true, hsnSac: true, placeOfSupplyState: true },
          })).filter((l) => !reversedOf.has(l.id));
          if (unused.length) {
            await tx.folioLine.createMany({
              data: unused.map((l) => ({
                folioId: r.folio!.id, type: "REVERSAL" as const,
                description: `Reversal: ${l.description} (stay shortened to ${data.newCheckOutDate})`,
                quantity: 1, unitPaise: -l.unitPaise, amountPaise: -l.amountPaise,
                taxRateBps: l.taxRateBps, cgstPaise: -l.cgstPaise, sgstPaise: -l.sgstPaise, igstPaise: -l.igstPaise,
                hsnSac: l.hsnSac, placeOfSupplyState: l.placeOfSupplyState,
                businessDate: new Date(), reversalOfId: l.id, postedById: user.userId,
              })),
            });
          }
          reversedNights = unused.length;
        }

        // Extensions that now lie (partly) past the new check-out.
        await tx.stayExtension.deleteMany({ where: { reservationId: r.id, fromDate: { gte: newCheckOut } } });
        await tx.stayExtension.updateMany({ where: { reservationId: r.id, toDate: { gt: newCheckOut } }, data: { toDate: newCheckOut } });

        await emitEvent(tx, { type: "ReservationModified", aggregateId: r.id, propertyId: r.propertyId, payload: { checkOutDate: data.newCheckOutDate, shortened: true, reversedNights } });
        await writeAudit(tx, {
          action: "reservation:shorten", entityType: "Reservation", entityId: r.id, propertyId: r.propertyId,
          before: { checkOutDate: r.checkOutDate.toISOString().slice(0, 10), nights: r.nights },
          after: { checkOutDate: data.newCheckOutDate, nights, reversedNights },
        });
        return { id: r.id, checkOutDate: data.newCheckOutDate, nights, reversedNights };
      }, { timeout: 15_000 }),
    );
    revalidatePath(`/bookings/${r.id}`);
    return result;
  });
}
