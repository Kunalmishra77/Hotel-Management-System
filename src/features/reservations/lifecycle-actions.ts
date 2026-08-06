"use server";

/**
 * Reservation lifecycle — 03 T-17/T-19/T-20 (FR-9/10/12, AC-12/15/16/17/18).
 *
 * cancel / check-in / check-out. Each: validate → authorize → assert the state
 * transition is legal (`canTransition`) → atomic status + room-status + folio
 * effects → event + audit. Illegal transitions (e.g. check-in a CANCELLED
 * booking, AC-18) are refused by the state machine, not the UI.
 */
import { requireUser } from "@/lib/auth";
import { authorize, hasPermission } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import { emitEvent, type EventCapableTx } from "@/lib/events";
import { DomainError, ErrorCode, NotFoundError } from "@/lib/errors";
import { toResult, type Result } from "@/lib/result";
import {
  ensureFolio,
  getBalance,
  postBookingExtrasTx,
  postPaymentTx,
  postRoomChargeTx,
  type BillingPostTx,
} from "@/features/billing";
import { canTransition } from "./domain/transitions";
import { priceReservation } from "./domain/pricing";
import { reservationDb, withReservationContext } from "./internal";
import { cancelReservationSchema, checkInSchema, checkOutSchema } from "./schema";

type LoadedReservation = {
  id: string;
  propertyId: string;
  code: string;
  status: string;
  nights: number;
  ratePaise: number;
  discountPaise: number;
  extraBedPaise: number;
  taxPaise: number;
  otherChargesPaise: number;
  advancePaise: number;
  settlementIntent: string;
  checkInDate: Date;
  checkOutDate: Date;
  allocations: { roomId: string }[];
};

const LOAD_SELECT = {
  id: true, propertyId: true, code: true, status: true, nights: true,
  ratePaise: true, discountPaise: true, extraBedPaise: true, taxPaise: true,
  otherChargesPaise: true, advancePaise: true, settlementIntent: true,
  checkInDate: true, checkOutDate: true,
  allocations: { select: { roomId: true } },
} as const;

export type LifecycleResult = { id: string; status: string };

/** Cancel a booking (AC-12): release allocations, free rooms, emit event. 🔒 */
export async function cancelReservation(input: unknown): Promise<Result<LifecycleResult>> {
  return toResult(async () => {
    const data = cancelReservationSchema.parse(input);
    const user = await requireUser();
    const client = reservationDb(user);
    const r = (await client.reservation.findFirst({
      where: { id: data.reservationId },
      select: LOAD_SELECT,
    })) as LoadedReservation | null;
    if (!r) throw new NotFoundError("Reservation not found.");
    authorize(user, "reservation:cancel", r.propertyId, { reason: data.reason });

    if (!canTransition(r.status as never, "CANCELLED")) {
      throw new DomainError(ErrorCode.ILLEGAL_TRANSITION);
    }

    return withReservationContext(user, () =>
      client.$transaction(async (tx) => {
        await tx.roomAllocation.deleteMany({ where: { reservationId: r.id } });
        await tx.reservation.updateMany({ where: { id: r.id }, data: { status: "CANCELLED" } });
        await freeRooms(tx as unknown as RoomStatusTx, r, "VACANT", "cancelled");
        await emitEvent(tx, {
          type: "ReservationCancelled",
          aggregateId: r.id,
          propertyId: r.propertyId,
          payload: { reason: data.reason },
        });
        await writeAudit(tx, {
          action: "reservation:cancel",
          entityType: "Reservation",
          entityId: r.id,
          propertyId: r.propertyId,
          reason: data.reason,
          before: { status: r.status },
          after: { status: "CANCELLED" },
        });
        return { id: r.id, status: "CANCELLED" };
      }),
    );
  });
}

/** Check in (AC-15): IN_HOUSE, rooms OCCUPIED, folio ensured, GuestCheckedIn. */
export async function checkIn(input: unknown): Promise<Result<LifecycleResult>> {
  return toResult(async () => {
    const { reservationId } = checkInSchema.parse(input);
    const user = await requireUser();
    const client = reservationDb(user);
    const r = (await client.reservation.findFirst({
      where: { id: reservationId },
      select: LOAD_SELECT,
    })) as LoadedReservation | null;
    if (!r) throw new NotFoundError("Reservation not found.");
    authorize(user, "checkin:perform", r.propertyId);

    if (!canTransition(r.status as never, "IN_HOUSE")) {
      throw new DomainError(ErrorCode.ILLEGAL_TRANSITION); // AC-18
    }

    return withReservationContext(user, () =>
      client.$transaction(async (tx) => {
        await tx.reservation.updateMany({
          where: { id: r.id },
          data: { status: "IN_HOUSE", checkInAt: new Date() },
        });
        const folioId = await ensureFolio(tx, { reservationId: r.id, propertyId: r.propertyId });

        // T4: money received at booking becomes a folio PAYMENT, so the folio —
        // not the reservation snapshot — reflects it. Idempotent by reference, so
        // a re-check-in can never double-post the advance.
        if (r.advancePaise > 0) {
          const reference = `ADVANCE:${r.id}`;
          const already = await tx.payment.findFirst({ where: { folioId, reference }, select: { id: true } });
          if (!already) {
            await postPaymentTx(tx as unknown as BillingPostTx, {
              folioId,
              propertyId: r.propertyId,
              mode: r.settlementIntent === "ALREADY_PAID" ? "ONLINE" : "CASH",
              amountPaise: r.advancePaise,
              reference,
              receivedById: user.userId,
            });
          }
        }

        // T5 (Option A): the agreed booking's NON-room charges (extra bed, other,
        // discount) become folio lines here, so the checkout gate reads the full
        // bill — not the room-only folio (which would drop the discount and
        // over-charge the guest). Room-nights are posted by night audit / checkout.
        // Idempotent: only if these line types are absent (check-in runs once).
        if (r.extraBedPaise > 0 || r.otherChargesPaise > 0 || r.discountPaise > 0) {
          const already = await tx.folioLine.findFirst({
            where: { folioId, type: { in: ["EXTRA_BED", "MISC", "DISCOUNT"] } },
            select: { id: true },
          });
          if (!already) {
            const property = await tx.property.findFirst({ where: { id: r.propertyId }, select: { state: true } });
            if (property) {
              await postBookingExtrasTx(tx as unknown as BillingPostTx, {
                folioId,
                propertyId: r.propertyId,
                propertyState: property.state,
                extraBedPaise: r.extraBedPaise,
                otherChargesPaise: r.otherChargesPaise,
                discountPaise: r.discountPaise,
                businessDate: r.checkInDate,
                postedById: user.userId,
              });
            }
          }
        }

        await freeRooms(tx as unknown as RoomStatusTx, r, "OCCUPIED", "check-in");
        await emitEvent(tx, {
          type: "GuestCheckedIn",
          aggregateId: r.id,
          propertyId: r.propertyId,
          payload: { code: r.code },
        });
        await writeAudit(tx, {
          action: "reservation:check-in",
          entityType: "Reservation",
          entityId: r.id,
          propertyId: r.propertyId,
          before: { status: r.status },
          after: { status: "IN_HOUSE" },
        });
        return { id: r.id, status: "IN_HOUSE" };
      }),
    );
  });
}

/** Check out (AC-16/17): balance gate (unless settled or folio:defer), rooms HOUSEKEEPING. */
export async function checkOut(input: unknown): Promise<Result<LifecycleResult>> {
  return toResult(async () => {
    const { reservationId, defer } = checkOutSchema.parse(input);
    const user = await requireUser();
    const client = reservationDb(user);
    const r = (await client.reservation.findFirst({
      where: { id: reservationId },
      select: LOAD_SELECT,
    })) as LoadedReservation | null;
    if (!r) throw new NotFoundError("Reservation not found.");
    authorize(user, "checkout:perform", r.propertyId);

    if (!canTransition(r.status as never, "CHECKED_OUT")) {
      throw new DomainError(ErrorCode.ILLEGAL_TRANSITION);
    }

    // T5: the FOLIO is the money truth (business-rules.md §6). Post any room-nights
    // not yet accrued by night audit — idempotent via the shared `(folioId,
    // businessDate) WHERE type='ROOM'` key, and the pre-check here means a repeat
    // never even attempts a duplicate insert — then gate on the LIVE folio balance.
    const folio = await client.folio.findFirst({
      where: { reservationId: r.id },
      select: { id: true, lines: { where: { type: "ROOM" }, select: { businessDate: true } } },
    });

    let balancePaise: number;
    if (folio) {
      const property = await client.property.findFirst({
        where: { id: r.propertyId },
        select: { state: true },
      });
      const posted = new Set(folio.lines.map((l) => dateKey(l.businessDate)));
      const toPost = stayNightDates(r.checkInDate, r.checkOutDate).filter((d) => !posted.has(dateKey(d)));

      if (toPost.length > 0 && property) {
        await withReservationContext(user, () =>
          client.$transaction(async (tx) => {
            for (const businessDate of toPost) {
              await postRoomChargeTx(tx as unknown as BillingPostTx, {
                folioId: folio.id,
                propertyId: r.propertyId,
                propertyState: property.state,
                ratePaise: r.ratePaise,
                businessDate,
                postedById: user.userId,
              });
            }
          }),
        );
      }
      balancePaise = (await getBalance(user, reservationId)) ?? 0;
    } else {
      // No folio — a booking that never checked in. Fall back to the snapshot.
      balancePaise = priceReservation({
        ratePaise: r.ratePaise, nights: r.nights, discountPaise: r.discountPaise,
        extraBedPaise: r.extraBedPaise, otherChargesPaise: r.otherChargesPaise,
        taxPaise: r.taxPaise, advancePaise: r.advancePaise,
      }).balancePaise;
    }

    if (balancePaise > 0) {
      // Deferring an unsettled balance is an elevated, permissioned act (AC-16/17).
      if (!defer || !hasPermission(user, "folio:defer")) {
        throw new DomainError(ErrorCode.BALANCE_UNSETTLED, undefined, {
          details: { balancePaise },
        });
      }
    }

    return withReservationContext(user, () =>
      client.$transaction(async (tx) => {
        await tx.reservation.updateMany({
          where: { id: r.id },
          data: { status: "CHECKED_OUT", checkOutAt: new Date() },
        });
        await freeRooms(tx as unknown as RoomStatusTx, r, "HOUSEKEEPING", "check-out");
        await emitEvent(tx, {
          type: "GuestCheckedOut",
          aggregateId: r.id,
          propertyId: r.propertyId,
          payload: { code: r.code, deferred: balancePaise > 0 },
        });
        await writeAudit(tx, {
          action: "reservation:check-out",
          entityType: "Reservation",
          entityId: r.id,
          propertyId: r.propertyId,
          before: { status: r.status },
          after: { status: "CHECKED_OUT", deferredBalancePaise: balancePaise > 0 ? balancePaise : 0 },
        });
        return { id: r.id, status: "CHECKED_OUT" };
      }),
    );
  });
}

/** The tx capabilities `freeRooms` needs — structural, like `EventCapableTx`. */
type RoomStatusTx = EventCapableTx & {
  room: {
    updateMany(args: {
      where: { id: { in: string[] } };
      data: { status: "VACANT" | "OCCUPIED" | "HOUSEKEEPING" };
    }): Promise<{ count: number }>;
  };
};

/** Set every allocated room to `status` and emit RoomStatusChanged for each. */
async function freeRooms(
  tx: RoomStatusTx,
  r: LoadedReservation,
  status: "VACANT" | "OCCUPIED" | "HOUSEKEEPING",
  reason: string,
): Promise<void> {
  const roomIds = r.allocations.map((a) => a.roomId);
  if (roomIds.length === 0) return;
  await tx.room.updateMany({ where: { id: { in: roomIds } }, data: { status } });
  for (const roomId of roomIds) {
    await emitEvent(tx, {
      type: "RoomStatusChanged",
      aggregateId: roomId,
      propertyId: r.propertyId,
      payload: { to: status, reason },
    });
  }
}

/** UTC yyyy-mm-dd key for comparing `@db.Date` business dates. */
function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Each night's business date for a stay: check-in (inclusive) → check-out (exclusive). */
function stayNightDates(checkIn: Date, checkOut: Date): Date[] {
  const dates: Date[] = [];
  const d = new Date(Date.UTC(checkIn.getUTCFullYear(), checkIn.getUTCMonth(), checkIn.getUTCDate()));
  const end = new Date(Date.UTC(checkOut.getUTCFullYear(), checkOut.getUTCMonth(), checkOut.getUTCDate()));
  while (d < end) {
    dates.push(new Date(d));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return dates;
}
