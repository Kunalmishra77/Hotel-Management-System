/**
 * Void & revise the GST invoices of stays whose bill changed after the invoice
 * was issued (16 Nov 2026: prepaid money the hotel kept was added as a charge).
 * Uses the app's own voidInvoice + generateInvoice — same credit note, gap-free
 * numbering, line snapshot, PDF and audit as pressing the buttons — acting as
 * the owner account. Bill-to name / GSTIN are carried over from the old invoice.
 *
 * Run inside the app container:
 *   npx tsx --require ./scripts/lib/as-user-hook.cjs scripts/revise-invoices.ts             (dry-run)
 *   CONFIRM=YES npx tsx --require ./scripts/lib/as-user-hook.cjs scripts/revise-invoices.ts (apply)
 */
import { PrismaClient } from "@prisma/client";
import { assembleClaims } from "../src/lib/auth/claims";
import { billParts, type PartContext } from "../src/features/billing";
import { generateInvoice, voidInvoice } from "../src/features/billing/invoice-actions";

const APPLY = process.env.CONFIRM === "YES";
const OWNER_EMAIL = "woodpecker.sunil@gmail.com";
const REASON = "Bill corrected after check-out: prepaid money retained (client decision 16 Nov 2026)";
const CODES = (process.env.CODES ?? "BK-HNUKDW1X,BK-T9V55K0Y,BK-13CR25QJ,BK-NUOUBOSX,BK-PA5KTEBR,BK-B2CWHY7Z,BK-14Z0IVSC,BK-12GIPG3W,BK-2KLW64UD,BK-WAJH7ORN,BK-28Q4BP28").split(",");
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } } });
const inr = (p: number | bigint) => `₹${(Number(p) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;

async function main() {
  const owner = await prisma.user.findFirstOrThrow({ where: { email: OWNER_EMAIL }, select: { id: true } });
  const claims = await assembleClaims(prisma, owner.id);
  if (!claims) throw new Error("owner has no claims");
  (globalThis as { __SCRIPT_CLAIMS?: unknown }).__SCRIPT_CLAIMS = { ...claims, activePropertyId: null };

  let failures = 0;
  for (const code of CODES) {
    const r = await prisma.reservation.findFirstOrThrow({
      where: { code },
      select: {
        source: true, guest: { select: { fullName: true } },
        extensions: { select: { fromDate: true, toDate: true, source: true } },
        folio: { select: {
          id: true,
          lines: { select: { id: true, type: true, description: true, businessDate: true, reversalOfId: true, amountPaise: true, cgstPaise: true, sgstPaise: true, igstPaise: true } },
          payments: { select: { mode: true, reference: true, amountPaise: true, isRefund: true } },
          invoices: { select: { id: true, number: true, type: true, cancelsInvoiceId: true, billPart: true, totalPaise: true, customerName: true, customerGstin: true } },
        } },
      },
    });
    const f = r.folio!;
    const ctx: PartContext = { bookingSource: r.source, extensions: r.extensions };
    const parts = billParts(f.lines, f.payments, ctx).filter((p) => p.lineIds.length > 0 && p.chargesPaise !== 0);
    const credited = new Set(f.invoices.filter((i) => i.cancelsInvoiceId).map((i) => i.cancelsInvoiceId));
    const live = f.invoices.filter((i) => i.type === "TAX_INVOICE" && !credited.has(i.id));
    // Only invoices whose bill no longer matches are revised.
    const stale = live.filter((i) => {
      const part = i.billPart ? parts.find((p) => p.part === i.billPart) : null;
      const now = i.billPart ? (part?.chargesPaise ?? 0) : parts.reduce((s, p) => s + p.chargesPaise, 0);
      return Number(i.totalPaise) !== now;
    });
    const targets = new Set(stale.flatMap((i) => (i.billPart ? [i.billPart] : parts.map((p) => p.part))));
    console.log(`${code} ${r.guest.fullName}`);
    if (stale.length === 0) { console.log("  invoices already match the bill — nothing to do"); continue; }
    for (const i of stale) console.log(`  void ${i.number} (${i.billPart ?? "whole stay"}) ${inr(i.totalPaise)}`);
    for (const p of parts.filter((x) => targets.has(x.part))) console.log(`  new  ${p.part} bill ${inr(p.chargesPaise)}`);
    if (!APPLY) continue;

    for (const i of stale) {
      const v = await voidInvoice({ invoiceId: i.id, reason: REASON });
      if (!v.ok) { failures++; console.log(`  ✗ void ${i.number}: ${v.error.message}`); continue; }
      console.log(`  ✓ credit note ${v.data.number} for ${i.number}`);
    }
    const billTo = stale[0]!;
    for (const part of targets) {
      const g = await generateInvoice({
        folioId: f.id,
        customerName: billTo.customerName || r.guest.fullName,
        customerGstin: billTo.customerGstin ?? undefined,
        billPart: parts.length > 1 || part !== "DIRECT" ? part : undefined,
      });
      if (!g.ok) { failures++; console.log(`  ✗ new ${part} invoice: ${g.error.message}`); continue; }
      console.log(`  ✓ new invoice ${g.data.number} (${part})`);
    }
  }
  console.log(APPLY ? `\nDone — ${failures} failure(s).` : "\nDRY RUN — nothing written. Re-run with CONFIRM=YES to apply.");
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
