/**
 * Night-audit room-night posting + the per-day revenue read — 06 T-19 (FR-5,
 * AC-18). NOT a "use server" module: called by 14's night audit under a system
 * context, sweeping every in-house folio.
 *
 * IDEMPOTENT by construction: the partial-unique index
 * `FolioLine(folioId, businessDate, revision) WHERE type='ROOM'` makes a re-run's
 * second ROOM line for the same folio+date+revision conflict — caught and
 * skipped. The audit always posts revision 0, so running twice posts each
 * room-night exactly once, and a night already re-posted at a later revision by
 * a rate correction is left alone (revision 0 still occupies the slot).
 */
import { db } from "@/lib/db";
import { runWithSystemContext } from "@/lib/context";
import { writeAudit } from "@/lib/audit";
import { emitEvent } from "@/lib/events";
import { roomGstBps } from "@/lib/constants/gst";
import { computeGst } from "./domain/gst";
import { folioBalance } from "./domain/balance";
import { activeLines, dateKey, netAmountByDate, netTaxable } from "./domain/reversal";
import { isUniqueViolation } from "./internal";
import { tailAllocations } from "@/features/reservations/domain/allocations";

/**
 * One business date's taxable revenue for a property, NET OF REVERSALS — the
 * basis for that day's room revenue, ADR, RevPAR and the revenue trend (14).
 *
 * Why this is not a `groupBy` aggregate: a REVERSAL carries `type='REVERSAL'`
 * and is posted on the day the correction is MADE, not on the night it cancels.
 * So `SUM(amountPaise) WHERE type='ROOM' AND businessDate = D` never saw the
 * reversal and reported the night at its original price forever — room revenue,
 * ADR and RevPAR stayed permanently inflated after any early check-out, rate
 * correction or transfer — while the total (`type != 'TAX'`) DID net the reversal
 * out, but out of whichever unrelated day it happened to land on. Resolving both
 * through the ledger's own active-line rule makes them consistent and attributes
 * every correction to the night it actually belongs to.
 */
export async function revenueForBusinessDate(
  propertyId: string,
  businessDate: Date,
): Promise<{ roomPaise: bigint; totalPaise: bigint }> {
  const prisma = db.unscoped();
  const dayLines = await prisma.folioLine.findMany({
    where: { folio: { propertyId }, businessDate },
    select: { id: true, type: true, amountPaise: true, cgstPaise: true, sgstPaise: true, igstPaise: true, businessDate: true, revision: true, reversalOfId: true },
  });
  if (dayLines.length === 0) return { roomPaise: 0n, totalPaise: 0n };

  // A reversal of one of this day's lines may sit on ANY later date, so the
  // reversals are fetched by target, not by date.
  const reversals = await prisma.folioLine.findMany({
    where: { folio: { propertyId }, reversalOfId: { in: dayLines.map((l) => l.id) } },
    select: { id: true, type: true, amountPaise: true, cgstPaise: true, sgstPaise: true, igstPaise: true, businessDate: true, revision: true, reversalOfId: true },
  });

  // Keep only this day's survivors: the reversals were pulled in purely to decide
  // which of the day's lines are still active. Room revenue goes through
  // `netAmountByDate` — the unit-tested statement of the per-night rule.
  const all = [...dayLines, ...reversals];
  const active = activeLines(all).filter((l) => l.businessDate.getTime() === businessDate.getTime());
  return {
    roomPaise: netAmountByDate(all, ["ROOM"]).get(dateKey(businessDate)) ?? 0n,
    totalPaise: netTaxable(active.filter((l) => l.type !== "TAX")),
  };
}

export async function postRoomCharges(
  propertyId: string,
  businessDate: Date,
): Promise<{ posted: number; skipped: number }> {
  const prisma = db.unscoped();
  const property = await prisma.property.findUnique({
    where: { id: propertyId },
    select: { orgId: true, state: true },
  });
  if (!property) return { posted: 0, skipped: 0 };

  const inHouse = await prisma.reservation.findMany({
    where: { propertyId, status: "IN_HOUSE" },
    select: { id: true, ratePaise: true, checkOutDate: true, folio: { select: { id: true } }, allocations: { select: { id: true, roomId: true, startDate: true, endDate: true } } },
  });
  const dayMs = 86_400_000;

  let posted = 0;
  let skipped = 0;
  await runWithSystemContext(property.orgId, async () => {
    for (const res of inHouse) {
      if (!res.folio) continue; // folio is ensured at check-in; skip if somehow absent
      const rateBps = roomGstBps(res.ratePaise);
      const gst = computeGst(res.ratePaise, rateBps, property.state, property.state); // on-premise → intra
      try {
        // Each in its own tx so one skipped duplicate doesn't abort the others
        // (a constraint violation poisons the whole Postgres transaction).
        await prisma.$transaction(async (tx) => {
          const line = await tx.folioLine.create({
            data: {
              folioId: res.folio!.id,
              type: "ROOM",
              description: "Room charge (night audit)",
              quantity: 1,
              unitPaise: res.ratePaise,
              amountPaise: BigInt(res.ratePaise),
              taxRateBps: rateBps,
              cgstPaise: gst.cgstPaise,
              sgstPaise: gst.sgstPaise,
              igstPaise: gst.igstPaise,
              hsnSac: "996311",
              placeOfSupplyState: property.state,
              businessDate,
            },
            select: { id: true },
          });
          await emitEvent(tx, { type: "FolioCharged", aggregateId: res.folio!.id, propertyId, payload: { lineId: line.id, type: "ROOM", amountPaise: res.ratePaise, businessDate: businessDate.toISOString().slice(0, 10) } });
          await writeAudit(tx, { action: "folio:room-night", entityType: "FolioLine", entityId: line.id, propertyId, after: { amountPaise: res.ratePaise } });
        });
        posted += 1;
      } catch (e) {
        if (isUniqueViolation(e)) {
          skipped += 1; // already posted for this folio+date — idempotent re-run
        } else {
          throw e;
        }
      }

      // Overstay: charging a night for a guest whose booked check-out has already passed
      // means they are STILL here, so the booking + inventory must say so — extend the
      // stay by this night and hold the room(s). Without this the allocation ended at the
      // booked check-out, the room showed FREE, and another booking could be taken on top
      // (overbooking). If another booking already holds a room for the night, that's a
      // genuine oversell → flag it for reception instead of silently overbooking.
      // Idempotent: once extended, checkOutDate > businessDate, so a re-run is a no-op.
      if (res.checkOutDate.getTime() <= businessDate.getTime() && res.allocations.length > 0) {
        const nextDay = new Date(businessDate.getTime() + dayMs);
        // Only the room(s) the guest is in at check-out are held for the extra night —
        // after a mid-stay move the old room's finished segment stays finished.
        const tail = tailAllocations(res.allocations, res.checkOutDate);
        const roomIds = tail.map((a) => a.roomId);
        const conflict = await prisma.roomAllocation.count({
          where: { roomId: { in: roomIds }, reservationId: { not: res.id }, startDate: { lt: nextDay }, endDate: { gt: businessDate } },
        });
        if (conflict === 0) {
          await prisma.$transaction(async (tx) => {
            await tx.roomAllocation.updateMany({ where: { id: { in: tail.map((a) => a.id) } }, data: { endDate: nextDay } });
            await tx.reservation.updateMany({ where: { id: res.id }, data: { checkOutDate: nextDay, nights: { increment: 1 } } });
            await emitEvent(tx, { type: "ReservationModified", aggregateId: res.id, propertyId, payload: { overstayExtended: true, checkOutDate: nextDay.toISOString().slice(0, 10) } });
            await writeAudit(tx, { action: "reservation:overstay-extend", entityType: "Reservation", entityId: res.id, propertyId, after: { checkOutDate: nextDay.toISOString().slice(0, 10) } });
          });
        } else {
          await prisma.reservation.updateMany({ where: { id: res.id, needsAttention: null }, data: { needsAttention: "OVERSELL" } });
        }
      }

      // Split stay / planned move: the guest changes room the morning after this
      // night. The room they leave needs cleaning; the room they go to is now
      // theirs. Idempotent — re-running only re-sets the same statuses.
      {
        const switchT = businessDate.getTime() + dayMs;
        const leaving = res.allocations.filter((a) => a.endDate.getTime() === switchT && switchT < res.checkOutDate.getTime()).map((a) => a.roomId);
        const arriving = res.allocations.filter((a) => a.startDate.getTime() === switchT).map((a) => a.roomId).filter((id) => !leaving.includes(id));
        const moves: [string[], "HOUSEKEEPING" | "OCCUPIED"][] = [[leaving.filter((id) => !arriving.includes(id)), "HOUSEKEEPING"], [arriving, "OCCUPIED"]];
        if (leaving.length > 0 || arriving.length > 0) {
          await prisma.$transaction(async (tx) => {
            for (const [ids, to] of moves) {
              if (ids.length === 0) continue;
              await tx.room.updateMany({ where: { id: { in: ids } }, data: { status: to } });
              for (const roomId of ids) {
                await emitEvent(tx, { type: "RoomStatusChanged", aggregateId: roomId, propertyId, payload: { to, reason: "split-stay-switch", reservationId: res.id } });
              }
            }
          });
        }
      }

      // FR-20 / AC-20: a folio still owing at close raises a reminder event.
      const f = await prisma.folio.findUnique({
        where: { id: res.folio.id },
        select: {
          lines: { select: { amountPaise: true, cgstPaise: true, sgstPaise: true, igstPaise: true } },
          payments: { select: { amountPaise: true, isRefund: true } },
        },
      });
      if (f && folioBalance(f.lines, f.payments) > 0n) {
        await prisma.$transaction(async (tx) => {
          await emitEvent(tx, { type: "PaymentDueDetected", aggregateId: res.folio!.id, propertyId, payload: { folioId: res.folio!.id, businessDate: businessDate.toISOString().slice(0, 10) } });
        });
      }
    }
  });

  return { posted, skipped };
}
