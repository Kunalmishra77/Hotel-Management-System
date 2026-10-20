/**
 * Void and re-issue the GST invoices whose folio has since been corrected.
 *
 * A tax invoice is immutable, so a folio corrected after it was raised is fixed
 * by a CREDIT NOTE cancelling the original and a fresh invoice for the corrected
 * figures. Both draw from the SAME company-wide gap-free series, allocated the
 * way `generateInvoice`/`voidInvoice` allocate it — the series row is upserted
 * then incremented in the same transaction, so a number can never be reused or
 * skipped even if reception issues one from the app at the same moment.
 *
 * A folio that now totals ₹0 (its booking was cancelled, or its charges moved
 * elsewhere) gets the credit note only — re-issuing would burn a number on an
 * empty bill, which `generateInvoice` refuses for the same reason.
 *
 * The invoice LINES are snapshotted onto each document, as the actions do, so
 * the PDF can never drift from its own totals. PDFs are not rendered here; they
 * render on first download.
 *
 *   $env:CODES="BK-A,BK-B"; npx tsx scripts/reissue-invoices.ts
 *   add $env:CONFIRM="YES" to apply
 */
import "dotenv/config";
import { PrismaClient, type Prisma } from "@prisma/client";
import { runWithSystemContext } from "../src/lib/context";
import { writeAudit } from "../src/lib/audit";
import { formatInvoiceNumber } from "../src/features/billing/domain/invoice-number";
import { financialYearOf } from "../src/features/billing/domain/money";

const APPLY = process.env.CONFIRM === "YES";
const CODES = (process.env.CODES ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } } });
const inr = (p: number | bigint) => `₹${(Number(p) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;

const isRoundOff = (l: { type: string; description: string }) => l.type === "MISC" && l.description === "Round off";

/** Allocate the next number from the company-wide series, exactly as the actions do. */
async function nextNumber(tx: Prisma.TransactionClient, orgId: string, fy: string): Promise<string> {
  await tx.companyInvoiceSeries.upsert({
    where: { orgId_financialYear: { orgId, financialYear: fy } },
    create: { orgId, financialYear: fy, prefix: "WASPL", nextNumber: 1 },
    update: {},
  });
  const series = await tx.companyInvoiceSeries.update({
    where: { orgId_financialYear: { orgId, financialYear: fy } },
    data: { nextNumber: { increment: 1 } },
    select: { prefix: true, nextNumber: true },
  });
  return formatInvoiceNumber({ prefix: series.prefix, financialYear: fy, nextNumber: series.nextNumber - 1 });
}

async function main() {
  if (CODES.length === 0) throw new Error("Set CODES to a comma-separated list of booking codes.");

  for (const code of CODES) {
    const r = await prisma.reservation.findFirstOrThrow({
      where: { code },
      select: {
        id: true, code: true, status: true, propertyId: true,
        guest: { select: { fullName: true, gstNumber: true } },
        property: { select: { orgId: true, name: true, state: true, timezone: true } },
        folio: {
          select: {
            id: true,
            lines: { orderBy: { createdAt: "asc" }, select: { id: true, type: true, description: true, quantity: true, unitPaise: true, amountPaise: true, taxRateBps: true, cgstPaise: true, sgstPaise: true, igstPaise: true, hsnSac: true, reversalOfId: true } },
            invoices: { select: { id: true, number: true, type: true, totalPaise: true, taxableValuePaise: true, cgstPaise: true, sgstPaise: true, igstPaise: true, financialYear: true, customerName: true, customerGstin: true, placeOfSupply: true, cancelsInvoiceId: true, lines: { select: { type: true, description: true, quantity: true, unitPaise: true, amountPaise: true, taxRateBps: true, cgstPaise: true, sgstPaise: true, igstPaise: true, hsnSac: true } } } },
          },
        },
      },
    });
    const folio = r.folio!;
    const cancelled = new Set(folio.invoices.filter((i) => i.cancelsInvoiceId).map((i) => i.cancelsInvoiceId!));
    const live = folio.invoices.filter((i) => i.type === "TAX_INVOICE" && !cancelled.has(i.id));

    // The bill the guest should get: active lines only, round-off outside tax.
    const reversed = new Set(folio.lines.filter((l) => l.reversalOfId).map((l) => l.reversalOfId));
    const active = folio.lines.filter((l) => l.type !== "REVERSAL" && !reversed.has(l.id));
    let taxable = 0n, cgst = 0, sgst = 0, igst = 0, roundOff = 0n;
    for (const l of active) {
      if (isRoundOff(l)) { roundOff += BigInt(l.amountPaise); continue; }
      taxable += BigInt(l.amountPaise); cgst += l.cgstPaise; sgst += l.sgstPaise; igst += l.igstPaise;
    }
    const total = taxable + BigInt(cgst + sgst + igst) + roundOff;

    console.log(`\n${r.code} [${r.status}] ${r.guest.fullName} @ ${r.property.name}`);
    for (const i of live) console.log(`  live invoice ${i.number} ${inr(i.totalPaise)}  ${Number(i.totalPaise) === Number(total) ? "— already matches, skipping" : `→ void, re-issue at ${inr(total)}`}`);
    if (live.length === 0) console.log(`  (no live invoice)`);
    const toFix = live.filter((i) => Number(i.totalPaise) !== Number(total));
    if (toFix.length === 0) continue;
    if (total === 0n) console.log(`  folio is ₹0 → credit note only, no replacement`);

    if (!APPLY) continue;

    const fy = financialYearOf(new Date(), r.property.timezone);
    await runWithSystemContext(r.property.orgId, async () => {
      await prisma.$transaction(async (tx) => {
        for (const original of toFix) {
          const cnNumber = await nextNumber(tx, r.property.orgId, original.financialYear);
          const cn = await tx.invoice.create({
            data: {
              propertyId: original.id ? r.propertyId : r.propertyId, folioId: folio.id, number: cnNumber,
              financialYear: original.financialYear, type: "CREDIT_NOTE", cancelsInvoiceId: original.id,
              customerName: original.customerName, customerGstin: original.customerGstin,
              placeOfSupply: original.placeOfSupply,
              taxableValuePaise: -original.taxableValuePaise, cgstPaise: -original.cgstPaise,
              sgstPaise: -original.sgstPaise, igstPaise: -original.igstPaise, totalPaise: -original.totalPaise,
            },
            select: { id: true },
          });
          if (original.lines.length > 0) {
            await tx.invoiceLine.createMany({
              data: original.lines.map((l, idx) => ({
                invoiceId: cn.id, type: l.type, description: l.description, quantity: l.quantity,
                unitPaise: l.unitPaise, amountPaise: -l.amountPaise, taxRateBps: l.taxRateBps,
                cgstPaise: -l.cgstPaise, sgstPaise: -l.sgstPaise, igstPaise: -l.igstPaise, hsnSac: l.hsnSac, sortOrder: idx,
              })),
            });
          }
          await writeAudit(tx, {
            action: "invoice:void", entityType: "Invoice", entityId: cn.id, propertyId: r.propertyId,
            reason: "folio corrected after the invoice was raised",
            after: { number: cnNumber, cancels: original.number },
          });
          console.log(`  credit note ${cnNumber} ${inr(-original.totalPaise)} cancels ${original.number}`);
        }

        if (total > 0n) {
          const number = await nextNumber(tx, r.property.orgId, fy);
          const inv = await tx.invoice.create({
            data: {
              propertyId: r.propertyId, folioId: folio.id, number, financialYear: fy, type: "TAX_INVOICE",
              customerName: r.guest.fullName, customerGstin: r.guest.gstNumber ?? null,
              placeOfSupply: igst > 0 ? r.property.state : r.property.state,
              taxableValuePaise: taxable, cgstPaise: cgst, sgstPaise: sgst, igstPaise: igst, totalPaise: total,
              pdfObjectKey: null,
            },
            select: { id: true },
          });
          await tx.invoiceLine.createMany({
            data: active.map((l, idx) => ({
              invoiceId: inv.id, type: String(l.type), description: l.description, quantity: l.quantity,
              unitPaise: l.unitPaise, amountPaise: l.amountPaise, taxRateBps: l.taxRateBps,
              cgstPaise: l.cgstPaise, sgstPaise: l.sgstPaise, igstPaise: l.igstPaise, hsnSac: l.hsnSac, sortOrder: idx,
            })),
          });
          await writeAudit(tx, {
            action: "invoice:generate", entityType: "Invoice", entityId: inv.id, propertyId: r.propertyId,
            after: { number, totalPaise: Number(total) },
          });
          console.log(`  NEW INVOICE ${number}  taxable ${inr(taxable)} + GST ${inr(cgst + sgst + igst)} = ${inr(total)}`);
        }
      });
    });
  }
  if (!APPLY) console.log("\nDRY RUN — set CONFIRM=YES to apply.");
}

main()
  .catch((e) => { console.error("FAILED:", e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
