/**
 * Adriana Karin, BK-AKV7L13E (HKD3, R1) — stayed ONE night, 10→11 Nov, and paid
 * ₹2,535 cash (GST included). She was never checked out, so the night audit
 * billed 11 Nov too, and the cash was never recorded. Fix (append-only):
 *  - reverse both posted nights; re-post 10 Nov at ₹2,414.28 + 5% GST = ₹2,535.00;
 *  - record the ₹2,535 cash payment;
 *  - check her out on 11 Nov (no overstay billing), room released if nobody else is in it.
 *   npx tsx scripts/fix-adriana-one-night.ts                      (dry-run)
 *   $env:CONFIRM="YES"; npx tsx scripts/fix-adriana-one-night.ts  (apply)
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { runWithSystemContext } from "../src/lib/context";
import { writeAudit } from "../src/lib/audit";
import { activeLines, folioBalance, nextRoomRevision, postPaymentTx, postRoomChargesTx, roomChargeLineData, type BillingBulkTx, type BillingPostTx } from "../src/features/billing";

const APPLY = process.env.CONFIRM === "YES";
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } } });
const inr = (p: number | bigint) => `₹${(Number(p) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
const NIGHT = new Date("2026-11-10T00:00:00Z");
const RATE = 241_428; // pre-tax; + 5% GST (₹60.36 + ₹60.36) = ₹2,535.00
const CASH = 253_500;

async function main() {
  const r = await prisma.reservation.findFirstOrThrow({
    where: { code: "BK-AKV7L13E" },
    select: {
      id: true, status: true, propertyId: true, checkOutDate: true,
      guest: { select: { fullName: true } },
      property: { select: { orgId: true, state: true } },
      allocations: { select: { roomId: true, room: { select: { number: true } } } },
      folio: { select: { id: true, lines: true, payments: { select: { amountPaise: true, isRefund: true } }, invoices: { select: { number: true } } } },
    },
  });
  if (!r.guest.fullName.toLowerCase().includes("adriana")) throw new Error("unexpected guest");
  if (r.status !== "IN_HOUSE") throw new Error(`status is ${r.status} — already handled?`);
  const folio = r.folio!;
  if (folio.invoices.length) throw new Error(`folio already has invoices ${folio.invoices.map((i) => i.number).join(", ")}`);
  const nights = activeLines(folio.lines).filter((l) => l.type === "ROOM");
  const check = roomChargeLineData({ folioId: "x", propertyId: r.propertyId, propertyState: r.property.state, ratePaise: RATE, businessDate: NIGHT });
  const gross = Number(check.amountPaise) + check.cgstPaise! + check.sgstPaise! + check.igstPaise!;
  if (gross !== CASH) throw new Error(`rate maths gives ${inr(gross)}, expected ₹2,535.00`);

  // Is anyone else in her room now? Then leave the room's status alone.
  const roomIds = r.allocations.map((a) => a.roomId);
  const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
  const others = await prisma.roomAllocation.count({ where: { roomId: { in: roomIds }, reservationId: { not: r.id }, startDate: { lte: today }, endDate: { gt: today }, reservation: { status: "IN_HOUSE" } } });

  console.log(`${r.guest.fullName} · ${r.status} · room ${r.allocations.map((a) => a.room.number).join(", ")} · balance ${inr(folioBalance(folio.lines, folio.payments))}`);
  console.log(`  reverse ${nights.length} night(s): ${nights.map((l) => `${l.businessDate.toISOString().slice(0, 10)} ${inr(Number(l.amountPaise) + l.cgstPaise + l.sgstPaise)}`).join(", ")}`);
  console.log(`  post 10 Nov at ${inr(RATE)} + GST = ${inr(gross)} · record cash ${inr(CASH)} · check out on 11 Nov · room ${others ? "kept (another guest is in it)" : "→ VACANT"}`);
  if (!APPLY) { console.log("\nDRY RUN — nothing written. Re-run with CONFIRM=YES to apply."); return; }

  await runWithSystemContext(r.property.orgId, async () => {
    await prisma.$transaction(async (tx) => {
      await tx.folioLine.createMany({
        data: nights.map((l) => ({
          folioId: folio.id, type: "REVERSAL" as const, description: `Reversal: ${l.description} (stayed one night, paid ₹2,535 incl. GST)`,
          quantity: 1, unitPaise: -l.unitPaise, amountPaise: -l.amountPaise, taxRateBps: l.taxRateBps,
          cgstPaise: -l.cgstPaise, sgstPaise: -l.sgstPaise, igstPaise: -l.igstPaise, hsnSac: l.hsnSac, placeOfSupplyState: l.placeOfSupplyState,
          businessDate: l.businessDate, reversalOfId: l.id, postedById: null,
        })),
      });
      await postRoomChargesTx(tx as unknown as BillingBulkTx, [{
        folioId: folio.id, propertyId: r.propertyId, propertyState: r.property.state, ratePaise: RATE,
        businessDate: NIGHT, revision: nextRoomRevision(folio.lines, NIGHT), postedById: null, description: "Room R1 · night",
      }]);
      await postPaymentTx(tx as unknown as BillingPostTx, { folioId: folio.id, propertyId: r.propertyId, mode: "CASH", amountPaise: CASH, reference: "Cash paid at check-out, 11 Nov (recorded 12 Nov)", receivedById: null, receivedAt: new Date("2026-11-11T05:30:00Z") });
      await tx.reservation.update({ where: { id: r.id }, data: { status: "CHECKED_OUT", checkOutAt: new Date("2026-11-11T05:30:00Z"), ratePaise: RATE, nights: 1 } });
      if (!others) await tx.room.updateMany({ where: { id: { in: roomIds } }, data: { status: "VACANT" } });
      await tx.domainEvent.create({ data: { orgId: r.property.orgId, propertyId: r.propertyId, type: "GuestCheckedOut", aggregateId: r.id, payload: { reason: "correction — stayed 10→11 Nov" } } });
      await writeAudit(tx, {
        action: "reservation:stay-correct", entityType: "Reservation", entityId: r.id, propertyId: r.propertyId,
        reason: "Stayed one night 10→11 Nov, paid ₹2,535 cash incl. GST; never checked out, so the night audit billed 11 Nov — script",
        before: { status: "IN_HOUSE", nights: nights.length }, after: { status: "CHECKED_OUT", nights: 1, grossPaise: CASH, cashPaise: CASH },
      });
    }, { maxWait: 10_000, timeout: 60_000 });
  });
  const after = await prisma.folio.findUniqueOrThrow({ where: { id: folio.id }, select: { lines: true, payments: { select: { amountPaise: true, isRefund: true } } } });
  console.log(`✅ Done. Balance ${inr(folioBalance(after.lines, after.payments))}. Next: Folio → Generate GST invoice.`);
}
main().catch((e) => { console.error("Failed:", e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
