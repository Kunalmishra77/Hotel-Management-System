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
  folioBalance,
  postBookingExtrasTx,
  postPaymentTx,
  postRoomChargeTx,
  autoIssueInvoiceOnCheckout,
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
        const flipped = await tx.reservation.updateMany({
          where: { id: r.id, status: r.status as never },
          data: { status: "CANCELLED" },
        });
        if (flipped.count !== 1) {
          throw new DomainError(ErrorCode.CONFLICT, "This booking is no longer available to cancel.");
        }
        await tx.roomAllocation.deleteMany({ where: { reservationId: r.id } });
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
        // Compare-and-swap: win the transition before any money posts, so two
        // concurrent check-ins can't both run the advance/extras postings (the
        // loser's tx rolls back on the CONFLICT).
        const flipped = await tx.reservation.updateMany({
          where: { id: r.id, status: r.status as never },
          data: { status: "IN_HOUSE", checkInAt: new Date() },
        });
        if (flipped.count !== 1) {
          throw new DomainError(ErrorCode.CONFLICT, "This booking is no longer available to check in.");
        }
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

        // Full-stay billing (transparency): at check-in the folio shows the WHOLE
        // booked amount — the non-room extras AND every booked room-night — rather
        // than trickling in via the night audit. So reception sees exactly what the
        // guest owes for the nights booked and collects it, with no "₹0 / why is it
        // 0" confusion. Both postings are idempotent: the EXTRA_BED/MISC/DISCOUNT
        // guard and the ROOM (folioId, businessDate) unique index mean a re-run OR
        // the nightly audit never double-charges. An early check-out later reverses
        // the unused future nights.
        const property = await tx.property.findFirst({ where: { id: r.propertyId }, select: { state: true } });
        if (property) {
          if (r.extraBedPaise > 0 || r.otherChargesPaise > 0 || r.discountPaise > 0) {
            const already = await tx.folioLine.findFirst({
              where: { folioId, type: { in: ["EXTRA_BED", "MISC", "DISCOUNT"] } },
              select: { id: true },
            });
            if (!already) {
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

          const roomLines = await tx.folioLine.findMany({ where: { folioId, type: "ROOM" }, select: { businessDate: true } });
          const posted = new Set(roomLines.map((l) => dateKey(l.businessDate)));
          const nightDates = stayNightDates(r.checkInDate, r.checkOutDate);
          // Day-use (check-in === check-out) is a single billable day.
          const toCharge = nightDates.length > 0 ? nightDates : [r.checkInDate];
          for (const businessDate of toCharge) {
            if (posted.has(dateKey(businessDate))) continue;
            await postRoomChargeTx(tx as unknown as BillingPostTx, {
              folioId,
              propertyId: r.propertyId,
              propertyState: property.state,
              ratePaise: r.ratePaise,
              businessDate,
              postedById: user.userId,
            });
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

    // Property state for GST on any un-accrued room-nights (immutable enough to read
    // outside the tx). The FOLIO is the money truth (business-rules.md §6).
    const property = await client.property.findFirst({
      where: { id: r.propertyId },
      select: { state: true, timezone: true },
    });

    // Early check-out: a guest leaving BEFORE their booked check-out is billed only
    // for the nights actually stayed (check-in → today, property-local), never the
    // full booking. We clamp the stay to today (min 1 night), so only stayed nights
    // post and the booking record + room availability reflect the real departure.
    const todayStr = property?.timezone
      ? new Date().toLocaleDateString("en-CA", { timeZone: property.timezone })
      : new Date().toISOString().slice(0, 10);
    const todayDate = new Date(`${todayStr}T00:00:00.000Z`);
    const minCheckOut = new Date(Date.UTC(r.checkInDate.getUTCFullYear(), r.checkInDate.getUTCMonth(), r.checkInDate.getUTCDate() + 1));
    let effectiveCheckOut = r.checkOutDate;
    if (todayDate.getTime() < r.checkOutDate.getTime()) {
      effectiveCheckOut = todayDate.getTime() < minCheckOut.getTime() ? minCheckOut : todayDate;
    }
    const isEarly = effectiveCheckOut.getTime() < r.checkOutDate.getTime();
    const effectiveNights = stayNightDates(r.checkInDate, effectiveCheckOut).length;

    // ONE transaction, so the balance we gate on and the status flip are atomic and
    // consistent (no TOCTOU): lock the folio FOR UPDATE first, so a concurrent charge/
    // payment OR a racing night-audit room-night insert serializes behind us. Then
    // post any un-accrued room-nights, derive the LIVE balance under the lock, gate,
    // and compare-and-swap the status.
    const result = await withReservationContext(user, () =>
      client.$transaction(async (tx) => {
        // 19 addendum (FR-17): un-accepted/un-settled POS orders (incl. guest QR
        // REQUESTED ones) are pending charges that can't be deferred — a REQUESTED
        // order posts NO folio line, so it would be invisible to the balance gate
        // below. Checked FIRST so staff resolve (accept→settle / reject) them
        // before check-out, never orphaning a charge on a checked-out reservation
        // (from which settleToFolio would be impossible).
        const pendingPos = await tx.posOrder.count({
          where: { reservationId: r.id, status: { in: ["REQUESTED", "OPEN"] } },
        });
        if (pendingPos > 0) {
          throw new DomainError(ErrorCode.POS_ORDERS_PENDING, undefined, { details: { pendingPos } });
        }

        const folio = await tx.folio.findFirst({ where: { reservationId: r.id }, select: { id: true } });

        let balancePaise: number;
        if (folio) {
          // Row-lock the folio: a concurrent FolioLine insert (POS charge, night audit)
          // takes a FOR KEY SHARE on this row for FK validation and blocks until we
          // commit, so our pre-check + inserts can't race a duplicate room-night.
          await tx.$executeRaw`SELECT id FROM "Folio" WHERE id = ${folio.id} FOR UPDATE`;

          const roomLines = await tx.folioLine.findMany({
            where: { folioId: folio.id, type: "ROOM" },
            select: { businessDate: true },
          });
          const posted = new Set(roomLines.map((l) => dateKey(l.businessDate)));
          // Bill only up to the EFFECTIVE check-out (today for an early departure), so
          // a guest leaving early is never charged for nights they didn't stay.
          const toPost = stayNightDates(r.checkInDate, effectiveCheckOut).filter((d) => !posted.has(dateKey(d)));
          if (property) {
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
          }

          // Early departure (full-stay billing): the unused FUTURE nights were
          // posted at check-in, so reverse every active ROOM line on/after the
          // effective check-out — the guest pays only for nights actually stayed.
          if (isEarly) {
            const reversedOf = new Set(
              (await tx.folioLine.findMany({ where: { folioId: folio.id, type: "REVERSAL" }, select: { reversalOfId: true } }))
                .map((l) => l.reversalOfId).filter((id): id is string => id !== null),
            );
            const unused = await tx.folioLine.findMany({
              where: { folioId: folio.id, type: "ROOM", businessDate: { gte: effectiveCheckOut } },
              select: { id: true, description: true, unitPaise: true, amountPaise: true, taxRateBps: true, cgstPaise: true, sgstPaise: true, igstPaise: true, hsnSac: true, placeOfSupplyState: true },
            });
            for (const l of unused) {
              if (reversedOf.has(l.id)) continue; // already reversed — don't double
              await tx.folioLine.create({
                data: {
                  folioId: folio.id, type: "REVERSAL",
                  description: `Reversal: ${l.description} (early check-out)`,
                  quantity: 1, unitPaise: -l.unitPaise, amountPaise: -l.amountPaise,
                  taxRateBps: l.taxRateBps, cgstPaise: -l.cgstPaise, sgstPaise: -l.sgstPaise, igstPaise: -l.igstPaise,
                  hsnSac: l.hsnSac, placeOfSupplyState: l.placeOfSupplyState,
                  businessDate: new Date(), reversalOfId: l.id, postedById: user.userId,
                },
              });
            }
          }

          const full = await tx.folio.findFirstOrThrow({
            where: { id: folio.id },
            select: {
              lines: { select: { amountPaise: true, cgstPaise: true, sgstPaise: true, igstPaise: true } },
              payments: { select: { amountPaise: true, isRefund: true } },
            },
          });
          balancePaise = Number(folioBalance(full.lines, full.payments));
        } else {
          // No folio — a booking that never checked in. Fall back to the snapshot.
          balancePaise = priceReservation({
            ratePaise: r.ratePaise, nights: effectiveNights, discountPaise: r.discountPaise,
            extraBedPaise: r.extraBedPaise, otherChargesPaise: r.otherChargesPaise,
            taxPaise: r.taxPaise, advancePaise: r.advancePaise,
          }).balancePaise;
        }

        // Deferring an unsettled balance is an elevated, permissioned act (AC-16/17).
        if (balancePaise > 0 && (!defer || !hasPermission(user, "folio:defer"))) {
          throw new DomainError(ErrorCode.BALANCE_UNSETTLED, undefined, { details: { balancePaise } });
        }

        // Compare-and-swap: only flip if the status is still what we observed, so a
        // concurrent check-out can't re-run the effects (duplicate GuestCheckedOut →
        // duplicate receipts/invoices downstream).
        const flipped = await tx.reservation.updateMany({
          where: { id: r.id, status: r.status as never },
          data: { status: "CHECKED_OUT", checkOutAt: new Date() },
        });
        if (flipped.count !== 1) {
          throw new DomainError(ErrorCode.CONFLICT, "This booking is no longer available to check out.");
        }

        // Early departure: record the real (shorter) stay and shrink the allocation so
        // the room is sellable again for the freed nights.
        if (isEarly) {
          await tx.reservation.updateMany({
            where: { id: r.id },
            data: { checkOutDate: effectiveCheckOut, nights: effectiveNights },
          });
          await tx.roomAllocation.updateMany({
            where: { reservationId: r.id },
            data: { endDate: effectiveCheckOut },
          });
        }

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

    // After the check-out commits, raise the GST tax invoice for the completed
    // stay (room-nights are now posted). Best-effort + idempotent — a failure
    // here never fails the check-out; the manual folio button remains available.
    await autoIssueInvoiceOnCheckout(r.id);
    return result;
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
