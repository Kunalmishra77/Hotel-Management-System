/**
 * One-time go-live helper: set the company-wide WASPL invoice counter so the NEXT
 * generated invoice carries the number the client is continuing from (their sample
 * shows 730). Idempotent and safe: it never moves the counter BACKWARDS, so running
 * it twice — or after real invoices have already gone past 730 — does nothing.
 *
 * Usage (against whichever DB the env points to):
 *   node scripts/set-invoice-start.mjs            # defaults to 730, current FY
 *   START=731 node scripts/set-invoice-start.mjs  # override the start number
 *
 * `generateInvoice` does: upsert(row) → increment → use (nextNumber - 1). So to make
 * the first invoice = 730, the row's nextNumber must be 730 (increment→731, use 730).
 */
import { PrismaClient } from "@prisma/client";

const ORG_ID = "org_woodpecker";
const START = Number(process.env.START ?? 730);

/** India financial year for a date: Apr–Mar, formatted "2026-27". */
function financialYear(date) {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit" })
    .format(date).split("-").map(Number);
  const start = p[1] >= 4 ? p[0] : p[0] - 1;
  return `${start}-${String(start + 1).slice(-2)}`;
}

const prisma = new PrismaClient();
try {
  const fy = financialYear(new Date());
  const existing = await prisma.companyInvoiceSeries.findUnique({
    where: { orgId_financialYear: { orgId: ORG_ID, financialYear: fy } },
    select: { nextNumber: true },
  });
  if (existing && existing.nextNumber >= START) {
    console.log(`No change: WASPL counter for FY ${fy} is already at ${existing.nextNumber} (>= ${START}).`);
  } else {
    await prisma.companyInvoiceSeries.upsert({
      where: { orgId_financialYear: { orgId: ORG_ID, financialYear: fy } },
      create: { orgId: ORG_ID, financialYear: fy, prefix: "WASPL", nextNumber: START },
      update: { nextNumber: START },
    });
    console.log(`Set WASPL invoice counter for FY ${fy} → next invoice will be number ${START} (e.g. "WASPL :${START}/ ${fy.slice(2)}").`);
  }
} finally {
  await prisma.$disconnect();
}
