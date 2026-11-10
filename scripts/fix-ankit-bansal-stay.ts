/**
 * Ankit bansal (10 Nov 2026 correction). Real stay: 14 Oct at Hauz Khas D-1/30
 * (BK-7SJDEVBJ), shifted to D-1/23 (BK-99OFFBL7) for 15 and 16 Oct, checked out
 * 17 Oct. Every night ₹2,100 + 5% GST (₹2,205); one dinner ₹300 + GST. Whole
 * stay ₹6,930, all paid.
 *
 * D-1/30 is already right (₹2,205 charged, ₹2,205 paid). D-1/23 is wrong: its
 * 16 Oct night was reversed as "departed 16 Oct" and the dinner is ₹600, so it
 * shows −₹1,890. Append-only fix on D-1/23 only:
 *   - stay 15→17 Oct (2 nights), room R1 allocation to 17 Oct
 *   - re-post the 16 Oct night at ₹2,100 + GST
 *   - reverse the ₹600 dinner, post ₹300 + GST
 * → D-1/23 ₹4,725 charged / ₹4,725 paid, balance ₹0.
 * Invoice WASPL 798 is NOT touched — void & revise it in the app afterwards.
 *
 *   npx tsx scripts/fix-ankit-bansal-stay.ts                       (dry-run)
 *   $env:CONFIRM="YES"; npx tsx scripts/fix-ankit-bansal-stay.ts   (apply)
 */
import "dotenv/config";
import { PrismaClient, type Prisma } from "@prisma/client";
import { runWithSystemContext } from "../src/lib/context";
import { writeAudit } from "../src/lib/audit";
import {
  folioBalance, nextRoomRevision, postRoomChargeTx, postServiceChargeTx, type BillingPostTx,
} from "../src/features/billing";

const APPLY = process.env.CONFIRM === "YES";
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } } });
const inr = (p: number | bigint) => `₹${(Number(p) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
const day = (s: string) => new Date(`${s}T00:00:00Z`);
const key = (d: Date) => d.toISOString().slice(0, 10);
const RATE = 210_000;

const SELECT = {
  id: true, code: true, status: true, propertyId: true, transferredFromId: true, checkOutDate: true,
  property: { select: { orgId: true, state: true } },
  allocations: { select: { id: true, roomId: true, startDate: true, endDate: true, room: { select: { number: true } } } },
  folio: {
    select: {
      id: true,
      lines: { select: { id: true, type: true, description: true, unitPaise: true, amountPaise: true, taxRateBps: true, cgstPaise: true, sgstPaise: true, igstPaise: true, hsnSac: true, placeOfSupplyState: true, businessDate: true, revision: true, reversalOfId: true } },
      payments: { select: { amountPaise: true, isRefund: true } },
    },
  },
} as const;
type Loaded = Prisma.ReservationGetPayload<{ select: typeof SELECT }>;

const balance = (r: Loaded) => folioBalance(r.folio!.lines, r.folio!.payments);
const active = (r: Loaded) => {
  const reversed = new Set(r.folio!.lines.filter((l) => l.reversalOfId).map((l) => l.reversalOfId));
  return r.folio!.lines.filter((l) => l.type !== "REVERSAL" && !reversed.has(l.id));
};
const charged = (r: Loaded) => active(r).reduce((s, l) => s + Number(l.amountPaise) + l.cgstPaise + l.sgstPaise + l.igstPaise, 0);

async function main() {
  const d23 = await prisma.reservation.findFirstOrThrow({ where: { code: "BK-99OFFBL7" }, select: SELECT });
  const d30 = await prisma.reservation.findFirstOrThrow({ where: { code: "BK-7SJDEVBJ" }, select: SELECT });
  if (d23.transferredFromId !== d30.id) throw new Error("BK-99OFFBL7 is not the continuation of BK-7SJDEVBJ");
  if (!d23.folio || !d30.folio) throw new Error("missing folio");
  if (d23.allocations.length !== 1 || d23.allocations[0]!.room.number !== "R1") throw new Error("expected one R1 allocation on BK-99OFFBL7");

  const a23 = active(d23);
  const nights = a23.filter((l) => l.type === "ROOM").map((l) => key(l.businessDate));
  if (nights.join() !== "2026-10-15") throw new Error(`active room nights on D-1/23 are ${nights.join()} — already corrected?`);
  const food = a23.filter((l) => l.type === "FOOD");
  if (food.length !== 1 || Number(food[0]!.amountPaise) !== 60_000) throw new Error("expected one active ₹600 FOOD line on D-1/23");
  const dinner = food[0]!;

  // R1 must be free on 16 Oct (the night being restored).
  const clash = await prisma.roomAllocation.findMany({
    where: { roomId: d23.allocations[0]!.roomId, reservationId: { not: d23.id }, startDate: { lt: day("2026-10-17") }, endDate: { gt: day("2026-10-16") }, reservation: { status: { in: ["CONFIRMED", "IN_HOUSE", "CHECKED_OUT"] } } },
    select: { reservation: { select: { code: true } } },
  });
  if (clash.length) throw new Error(`R1 is taken on 16 Oct by ${clash.map((c) => c.reservation.code).join(", ")}`);

  console.log(`D-1/30 ${d30.code}: charged ${inr(charged(d30))} · balance ${inr(balance(d30))} (unchanged)`);
  console.log(`D-1/23 ${d23.code}: charged ${inr(charged(d23))} · balance ${inr(balance(d23))}`);
  console.log(`  → stay 15→17 Oct (2 nights), R1 to 17 Oct`);
  console.log(`  → re-post 16 Oct night ₹2,100 + GST · dinner ₹600 reversed → ₹300 + GST`);
  console.log(`  → expected: charged ₹4,725.00 · balance ₹0.00 (whole stay ₹6,930)`);
  if (!APPLY) { console.log("\nDRY RUN — nothing written. Re-run with CONFIRM=YES to apply."); return; }

  const why = "Guest stayed D-1/23 15 and 16 Oct, checked out 17 Oct (not 16); one dinner ₹300 — correction 10 Nov 2026, script";
  await runWithSystemContext(d23.property.orgId, async () => {
    await prisma.$transaction(async (tx) => {
      const t = tx as unknown as BillingPostTx;
      const fid = d23.folio!.id;
      await postRoomChargeTx(t, {
        folioId: fid, propertyId: d23.propertyId, propertyState: d23.property.state, ratePaise: RATE,
        businessDate: day("2026-10-16"), revision: nextRoomRevision(d23.folio!.lines, day("2026-10-16")),
        description: "Room R1 · night (guest stayed — checked out 17 Oct)",
      });
      await tx.folioLine.create({
        data: {
          folioId: fid, type: "REVERSAL", description: `Reversal: ${dinner.description.trim()} (one dinner, ₹300)`, quantity: 1,
          unitPaise: -dinner.unitPaise, amountPaise: -dinner.amountPaise, taxRateBps: dinner.taxRateBps,
          cgstPaise: -dinner.cgstPaise, sgstPaise: -dinner.sgstPaise, igstPaise: -dinner.igstPaise,
          hsnSac: dinner.hsnSac, placeOfSupplyState: dinner.placeOfSupplyState,
          businessDate: dinner.businessDate, reversalOfId: dinner.id, postedById: null,
        },
      });
      await postServiceChargeTx(t, { folioId: fid, propertyId: d23.propertyId, propertyState: d23.property.state, type: "FOOD", amountPaise: 30_000, description: "Dinner", businessDate: day("2026-10-16"), postedById: null });
      await tx.roomAllocation.update({ where: { id: d23.allocations[0]!.id }, data: { endDate: day("2026-10-17") } });
      await tx.reservation.update({ where: { id: d23.id }, data: { checkOutDate: day("2026-10-17"), nights: 2 } });
      await tx.domainEvent.create({ data: { orgId: d23.property.orgId, propertyId: d23.propertyId, type: "ReservationModified", aggregateId: d23.id, payload: { reason: "stay-correct", checkOutDate: "2026-10-17" } } });
      await writeAudit(tx, {
        action: "reservation:stay-correct", entityType: "Reservation", entityId: d23.id, propertyId: d23.propertyId, reason: why,
        before: { checkOutDate: key(d23.checkOutDate), nights: 1, dinnerPaise: 60_000, balancePaise: Number(balance(d23)) },
        after: { checkOutDate: "2026-10-17", nights: 2, dinnerPaise: 30_000 },
      });
    }, { maxWait: 10_000, timeout: 60_000 });
  });

  const after = await prisma.reservation.findFirstOrThrow({ where: { id: d23.id }, select: SELECT });
  console.log(`\nAFTER D-1/23 ${after.code}: charged ${inr(charged(after))} · balance ${inr(balance(after))} · ${key(after.checkOutDate)}`);
  console.log("✅ Done. Next: rebuild HKD23 snapshots 15–16 Oct, then Void & revise invoice WASPL 798 in the app.");
}

main().catch((e) => { console.error("Failed:", e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
