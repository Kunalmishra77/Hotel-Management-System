/**
 * One-off: add the food charges the client collected but forgot to bill for
 * Siddhant Akhil Jajodia (BK-GJH2NVZT) — the stay was saved history-only (no folio),
 * so this creates the folio and posts the two food lines at 5% GST:
 *   Veg     ₹300 + 5% = ₹315
 *   Non-veg ₹400 + 5% = ₹420   (total ₹735)
 *
 * Append-only safe (INSERT only, no guards touched). Idempotent: it refuses to run
 * again if food lines already exist on the folio. Dry-run unless CONFIRM=YES.
 *
 *   node scripts/add-siddhant-food.mjs            # dry-run
 *   CONFIRM=YES node scripts/add-siddhant-food.mjs
 */
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const CONFIRM = process.env.CONFIRM === "YES";
const RESV = "BK-GJH2NVZT";
const ITEMS = [
  { desc: "FOOD — Veg (dinner)", taxable: 30000 },     // ₹300
  { desc: "FOOD — Non-veg (dinner)", taxable: 40000 }, // ₹400
];

try {
  const r = await prisma.reservation.findFirst({ where: { code: RESV }, select: { id: true, propertyId: true, checkOutDate: true, property: { select: { state: true } } } });
  if (!r) throw new Error(`Reservation ${RESV} not found`);
  const existing = await prisma.folio.findUnique({ where: { reservationId: r.id }, select: { id: true, lines: { where: { type: "FOOD" }, select: { id: true } } } });
  if (existing && existing.lines.length > 0) {
    console.log("Food lines already exist on this folio — nothing to do (idempotent).");
    process.exit(0);
  }
  const state = r.property.state; // Delhi → intra-state CGST+SGST
  const bizDate = r.checkOutDate ?? new Date();
  console.log(`Reservation ${RESV} · property state ${state} · items:`);
  for (const it of ITEMS) {
    const g = Math.round((it.taxable * 250) / 10000);
    console.log(`  ${it.desc}: taxable ₹${(it.taxable/100).toFixed(2)} + GST ₹${((2*g)/100).toFixed(2)} = ₹${((it.taxable+2*g)/100).toFixed(2)}`);
  }
  if (!CONFIRM) { console.log("\nDRY RUN — re-run with CONFIRM=YES to apply."); await prisma.$disconnect(); process.exit(0); }

  const folioId = await prisma.$transaction(async (tx) => {
    let folio = existing ?? await tx.folio.create({ data: { propertyId: r.propertyId, reservationId: r.id, kind: "RESERVATION" }, select: { id: true, lines: true } });
    for (const it of ITEMS) {
      const g = Math.round((it.taxable * 250) / 10000);
      await tx.folioLine.create({ data: {
        folioId: folio.id, type: "FOOD", description: it.desc, quantity: 1, unitPaise: it.taxable,
        amountPaise: BigInt(it.taxable), taxRateBps: 500, cgstPaise: g, sgstPaise: g, igstPaise: 0,
        hsnSac: "996331", placeOfSupplyState: state, businessDate: bizDate,
      } });
    }
    return folio.id;
  });
  console.log(`APPLIED ✓ folio ${folioId} — food ₹735 added. Open the folio, take the ₹735 payment (already collected), and Generate GST invoice.`);
} finally {
  await prisma.$disconnect();
}
