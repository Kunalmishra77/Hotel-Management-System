/**
 * Clean S Prabhaharan's (BK-S0ZC2JL9) -₹0.50 balance: the ₹10 discount was
 * applied PRE_TAX (took ₹10.50 off). Reverse it and re-apply a FLAT ₹10 discount
 * (zero GST), so the bill = ₹14,900 = cash paid → balance exactly ₹0.
 *
 *   npx tsx scripts/fix-sprabhaharan-discount.ts                      (dry-run)
 *   $env:CONFIRM="YES"; npx tsx scripts/fix-sprabhaharan-discount.ts  (apply)
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const APPLY = process.env.CONFIRM === "YES";
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } } });
const inr = (p: number | bigint) => `₹${(Number(p) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;

async function balance(folioId: string) {
  const f = await prisma.folio.findUniqueOrThrow({
    where: { id: folioId },
    select: { lines: { select: { amountPaise: true, cgstPaise: true, sgstPaise: true, igstPaise: true } }, payments: { select: { amountPaise: true, isRefund: true } } },
  });
  let c = 0n; for (const l of f.lines) c += BigInt(l.amountPaise) + BigInt(l.cgstPaise) + BigInt(l.sgstPaise) + BigInt(l.igstPaise);
  let p = 0n; for (const q of f.payments) { const a = BigInt(q.amountPaise); p += q.isRefund ? -a : a; }
  return c - p;
}

async function main() {
  const r = await prisma.reservation.findFirst({ where: { code: "BK-S0ZC2JL9" }, select: { propertyId: true, folio: { select: { id: true } } } });
  if (!r?.folio) throw new Error("folio not found");
  const fid = r.folio.id;

  // The active PRE_TAX discount line (has GST) we need to undo.
  const lines = await prisma.folioLine.findMany({ where: { folioId: fid, type: "DISCOUNT" }, select: { id: true, description: true, unitPaise: true, amountPaise: true, taxRateBps: true, cgstPaise: true, sgstPaise: true, igstPaise: true, hsnSac: true, placeOfSupplyState: true } });
  const reversedIds = new Set((await prisma.folioLine.findMany({ where: { folioId: fid, type: "REVERSAL" }, select: { reversalOfId: true } })).map((l) => l.reversalOfId).filter(Boolean));
  const bad = lines.find((l) => !reversedIds.has(l.id) && (l.cgstPaise !== 0 || l.sgstPaise !== 0 || l.igstPaise !== 0));

  console.log("Before:", inr(await balance(fid)));
  if (!bad) { console.log("No PRE_TAX discount to fix. Nothing to do."); return; }
  console.log(`Will reverse discount "${bad.description}" (${inr(Number(bad.amountPaise) + bad.cgstPaise + bad.sgstPaise + bad.igstPaise)}) and re-apply a flat ₹10 (no GST).`);

  if (!APPLY) { console.log("\nDRY RUN — nothing written. Re-run with CONFIRM=YES to apply."); return; }
  await prisma.$transaction(async (tx) => {
    await tx.folioLine.create({ data: {
      folioId: fid, type: "REVERSAL", description: `Reversal: ${bad.description} (discount re-applied flat)`, quantity: 1,
      unitPaise: -bad.unitPaise, amountPaise: -bad.amountPaise, taxRateBps: bad.taxRateBps,
      cgstPaise: -bad.cgstPaise, sgstPaise: -bad.sgstPaise, igstPaise: -bad.igstPaise,
      hsnSac: bad.hsnSac, placeOfSupplyState: bad.placeOfSupplyState, businessDate: new Date(), reversalOfId: bad.id, postedById: null,
    } });
    await tx.folioLine.create({ data: {
      folioId: fid, type: "DISCOUNT", description: "Discount (flat ₹10)", quantity: 1,
      unitPaise: -1000, amountPaise: BigInt(-1000), taxRateBps: 0, cgstPaise: 0, sgstPaise: 0, igstPaise: 0,
      placeOfSupplyState: bad.placeOfSupplyState, businessDate: new Date(), postedById: null,
    } });
  });
  console.log("After: ", inr(await balance(fid)));
}

main().catch((e) => { console.error("Failed:", e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
