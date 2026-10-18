/**
 * Ankit Bansal, Oct 2026 — correct the journey to the stay that actually happened.
 *
 * Client confirmation (18 Oct 2026): TWO nights, not three.
 *   14 → 15 Oct  D-1/30 R1  arrived via Booking.com   1 night @ ₹2,100 + GST
 *   15 → 16 Oct  D-1/23 R1  continued direct          1 night @ ₹2,100 + GST
 *   plus ₹600 + GST food
 *
 * Two things are wrong against that:
 *   · BK-7SJDEVBJ is recorded as DIRECT. It was an online (Booking.com) booking,
 *     so revenue-by-source currently credits Direct with a night the OTA brought.
 *     Money does not move; only the attribution.
 *   · BK-99OFFBL7 runs to 17 Oct and bills the 16 Oct night. The guest left on
 *     16 Oct, so that night was never stayed — reverse it, shrink the booking and
 *     release the room for the freed night.
 *
 * The ₹600 food sits on business date 17 Oct, outside the corrected stay. It
 * moves to 15 Oct, the night actually stayed at that property — leaving it where
 * it is would recreate the out-of-stay dating this codebase has just been cleaned
 * of. Amount and GST are carried across untouched.
 *
 * The guest has paid ₹6,930 against a corrected total of ₹5,040, so ₹1,890 is
 * REFUNDABLE. No refund row is written here: that is real money leaving the till
 * and must be recorded by whoever actually hands it back. The folio carries the
 * credit until then.
 *
 *   npx tsx scripts/fix-ankit-bansal-oct.ts                      (dry-run)
 *   $env:CONFIRM="YES"; npx tsx scripts/fix-ankit-bansal-oct.ts  (apply)
 */
import "dotenv/config";
import { PrismaClient, type Prisma } from "@prisma/client";
import { runWithSystemContext } from "../src/lib/context";
import { writeAudit } from "../src/lib/audit";
import { folioBalance } from "../src/features/billing";
import { activeLines, dateKey } from "../src/features/billing/domain/reversal";

const APPLY = process.env.CONFIRM === "YES";
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } } });
const inr = (p: number | bigint) => `₹${(Number(p) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
const utc = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

const NEW_CHECKOUT = utc("2026-10-16");   // guest departed 16 Oct
const DROP_FROM = "2026-10-16";           // nights on/after this were not stayed
const FOOD_TO = utc("2026-10-15");        // the night actually stayed at D-1/23

const LINE_SELECT = {
  id: true, type: true, description: true, quantity: true, unitPaise: true, amountPaise: true,
  taxRateBps: true, cgstPaise: true, sgstPaise: true, igstPaise: true, hsnSac: true,
  placeOfSupplyState: true, businessDate: true, revision: true, reversalOfId: true,
} as const;

async function balanceOf(folioId: string): Promise<bigint> {
  const f = await prisma.folio.findUniqueOrThrow({
    where: { id: folioId },
    select: { lines: { select: { amountPaise: true, cgstPaise: true, sgstPaise: true, igstPaise: true } }, payments: { select: { amountPaise: true, isRefund: true } } },
  });
  return folioBalance(f.lines, f.payments);
}

type Row = { id: string; description: string; unitPaise: number; amountPaise: bigint; taxRateBps: number; cgstPaise: number; sgstPaise: number; igstPaise: number; hsnSac: string | null; placeOfSupplyState: string | null };
function reversal(folioId: string, l: Row, reason: string): Prisma.FolioLineUncheckedCreateInput {
  return {
    folioId, type: "REVERSAL", description: `Reversal: ${l.description} (${reason})`,
    quantity: 1, unitPaise: -l.unitPaise, amountPaise: -l.amountPaise, taxRateBps: l.taxRateBps,
    cgstPaise: -l.cgstPaise, sgstPaise: -l.sgstPaise, igstPaise: -l.igstPaise,
    hsnSac: l.hsnSac, placeOfSupplyState: l.placeOfSupplyState,
    businessDate: new Date(), reversalOfId: l.id,
  };
}

async function main() {
  const inserts: Prisma.FolioLineUncheckedCreateInput[] = [];

  // ---- A · BK-7SJDEVBJ: the OTA attribution -------------------------------
  const a = await prisma.reservation.findFirstOrThrow({
    where: { code: "BK-7SJDEVBJ" },
    select: { id: true, code: true, source: true, propertyId: true, nights: true, property: { select: { orgId: true, name: true } } },
  });
  console.log(`${a.code} @ ${a.property.name} — source ${a.source} → BOOKING_COM (${a.nights} night, money unchanged)`);

  // ---- B · BK-99OFFBL7: the night that was never stayed --------------------
  const b = await prisma.reservation.findFirstOrThrow({
    where: { code: "BK-99OFFBL7" },
    select: {
      id: true, code: true, checkInDate: true, checkOutDate: true, nights: true, propertyId: true,
      property: { select: { orgId: true, name: true } },
      allocations: { select: { id: true, endDate: true, room: { select: { number: true } } } },
      folio: { select: { id: true } },
    },
  });
  const folioB = b.folio!.id;
  const rows = await prisma.folioLine.findMany({ where: { folioId: folioB }, select: LINE_SELECT });
  console.log(`\n${b.code} @ ${b.property.name} — ${dateKey(b.checkInDate)} → ${dateKey(b.checkOutDate)} (${b.nights}n) becomes → ${dateKey(NEW_CHECKOUT)} (1n)`);
  console.log(`  before: balance ${inr(await balanceOf(folioB))}`);

  for (const l of activeLines(rows)) {
    if (l.type === "ROOM" && dateKey(l.businessDate) >= DROP_FROM) {
      inserts.push(reversal(folioB, l, "night not stayed — guest departed 16 Oct"));
      console.log(`  − reverse ${dateKey(l.businessDate)} ROOM ${inr(l.amountPaise)}`);
    }
    if (l.type === "FOOD" && dateKey(l.businessDate) > dateKey(NEW_CHECKOUT)) {
      inserts.push(reversal(folioB, l, "re-dated into the stay"));
      inserts.push({
        folioId: folioB, type: "FOOD", description: l.description, quantity: l.quantity,
        unitPaise: l.unitPaise, amountPaise: l.amountPaise, taxRateBps: l.taxRateBps,
        cgstPaise: l.cgstPaise, sgstPaise: l.sgstPaise, igstPaise: l.igstPaise,
        hsnSac: l.hsnSac, placeOfSupplyState: l.placeOfSupplyState,
        businessDate: FOOD_TO, revision: 0,
      });
      console.log(`  → move    ${dateKey(l.businessDate)} FOOD ${inr(l.amountPaise)} ⇒ ${dateKey(FOOD_TO)}  "${l.description.trim()}"`);
    }
  }

  if (!APPLY) {
    console.log(`\n${inserts.length} folio line(s) to append, 2 reservation update(s).`);
    console.log("DRY RUN — set CONFIRM=YES to apply.");
    return;
  }

  await runWithSystemContext(a.property.orgId, async () => {
    await prisma.$transaction(async (tx) => {
      for (const data of inserts) await tx.folioLine.create({ data });

      await tx.reservation.update({ where: { id: a.id }, data: { source: "BOOKING_COM" } });
      await writeAudit(tx, {
        action: "reservation:modify", entityType: "Reservation", entityId: a.id, propertyId: a.propertyId,
        reason: "arrived via Booking.com, not direct (client confirmation)",
        before: { source: a.source }, after: { source: "BOOKING_COM" },
      });

      await tx.reservation.update({ where: { id: b.id }, data: { checkOutDate: NEW_CHECKOUT, nights: 1 } });
      // Release the freed night so the room is sellable again for it.
      for (const al of b.allocations) {
        await tx.roomAllocation.update({ where: { id: al.id }, data: { endDate: NEW_CHECKOUT } });
      }
      await writeAudit(tx, {
        action: "reservation:modify", entityType: "Reservation", entityId: b.id, propertyId: b.propertyId,
        reason: "guest departed 16 Oct; the 16-Oct night was never stayed (client confirmation)",
        before: { checkOutDate: dateKey(b.checkOutDate), nights: b.nights },
        after: { checkOutDate: dateKey(NEW_CHECKOUT), nights: 1 },
      });
    });
  });

  console.log(`\n=== AFTER ===`);
  for (const code of ["BK-7SJDEVBJ", "BK-99OFFBL7"]) {
    const r = await prisma.reservation.findFirstOrThrow({ where: { code }, select: { code: true, source: true, nights: true, checkInDate: true, checkOutDate: true, folio: { select: { id: true } } } });
    console.log(`  ${r.code} ${r.source.padEnd(12)} ${dateKey(r.checkInDate)}→${dateKey(r.checkOutDate)} (${r.nights}n) balance ${inr(await balanceOf(r.folio!.id))}`);
  }
}

main()
  .catch((e) => { console.error("FAILED:", e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
