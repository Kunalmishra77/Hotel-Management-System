/**
 * Checked-out stays that show MINUS (money received above the bill) → ₹0.
 * Client decision (16 Nov 2026): "the hotel kept it — set all to ₹0".
 *
 * For each checked-out folio with a credit of ₹1 or more, one append-only line
 * equal to the credit, 5% GST inside (accommodation slab, HSN 996311):
 *  - stay ended early (unused nights reversed) → "Early departure charge — …
 *    (prepaid, non-refundable)", dated the first unused night;
 *  - otherwise → "Excess payment retained — received more than billed", dated
 *    the last night.
 * Both follow the nights' channel, so an OTA's money stays on the OTA bill.
 * Issued invoices are NOT touched — the list printed at the end needs Void & revise.
 *
 * Run inside the app container:
 *   npx tsx scripts/settle-credit-balances.ts              (dry-run)
 *   CONFIRM=YES npx tsx scripts/settle-credit-balances.ts  (apply)
 */
import { PrismaClient } from "@prisma/client";
import { runWithSystemContext } from "../src/lib/context";
import { writeAudit } from "../src/lib/audit";
import { folioBalance } from "../src/features/billing";

const APPLY = process.env.CONFIRM === "YES";
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } } });
const inr = (p: number | bigint) => `₹${(Number(p) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
const BPS = 500;
const DAY = 86_400_000;

async function main() {
  const rows = await prisma.reservation.findMany({
    where: { status: "CHECKED_OUT", folio: { isNot: null } },
    select: {
      id: true, code: true, source: true, propertyId: true, checkInDate: true, checkOutDate: true,
      guest: { select: { fullName: true } },
      property: { select: { orgId: true, state: true } },
      folio: { select: { id: true, lines: true, payments: true, invoices: { select: { id: true, number: true, type: true, cancelsInvoiceId: true } } } },
    },
  });
  const todo = rows
    .map((r) => ({ r, bal: Number(folioBalance(r.folio!.lines, r.folio!.payments)) }))
    .filter((x) => x.bal <= -100)
    .sort((a, b) => a.bal - b.bal);

  const plan = todo.map(({ r, bal }) => {
    const lines = r.folio!.lines;
    const byId = new Map(lines.map((l) => [l.id, l]));
    const earlyRev = lines.filter((l) => l.type === "REVERSAL" && l.description.includes("(early check-out)"));
    const firstUnused = earlyRev.map((l) => byId.get(l.reversalOfId ?? "")?.businessDate).filter((d): d is Date => !!d).sort((a, b) => a.getTime() - b.getTime())[0];
    const early = earlyRev.length > 0 && !!firstUnused;
    const keep = -bal;
    const pre = Math.round((keep * 10_000) / (10_000 + BPS));
    const gst = keep - pre;
    const cgst = Math.floor(gst / 2);
    const fmt = (d: Date) => d.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
    const description = early
      ? `Early departure charge — unused night(s) from ${fmt(firstUnused!)} retained (prepaid, non-refundable)`
      : "Excess payment retained — received more than billed";
    const businessDate = early ? firstUnused! : new Date(Math.max(r.checkInDate.getTime(), r.checkOutDate.getTime() - DAY));
    const credited = new Set(r.folio!.invoices.filter((i) => i.cancelsInvoiceId).map((i) => i.cancelsInvoiceId));
    const liveInvoices = r.folio!.invoices.filter((i) => i.type === "TAX_INVOICE" && !credited.has(i.id)).map((i) => i.number);
    return { r, keep, pre, cgst, sgst: gst - cgst, description, businessDate, liveInvoices };
  });

  for (const p of plan) {
    console.log(`${p.r.code.padEnd(12)} ${p.r.source.padEnd(11)} ${p.r.guest.fullName.slice(0, 28).padEnd(28)} ${inr(-p.keep).padStart(11)} → +${inr(p.keep)} ${p.description.startsWith("Early") ? "early-departure" : "excess"}${p.liveInvoices.length ? `  [invoice ${p.liveInvoices.join(", ")}]` : ""}`);
  }
  console.log(`\n${plan.length} booking(s), ${inr(plan.reduce((s, p) => s + p.keep, 0))} in total.`);
  if (!APPLY) { console.log("DRY RUN — nothing written. Re-run with CONFIRM=YES to apply."); return; }

  for (const p of plan) {
    await runWithSystemContext(p.r.property.orgId, async () => {
      await prisma.$transaction(async (tx) => {
        // Re-check under the transaction: skip if someone settled it meanwhile.
        const f = await tx.folio.findUniqueOrThrow({ where: { id: p.r.folio!.id }, select: { lines: true, payments: true } });
        if (Number(folioBalance(f.lines, f.payments)) !== -p.keep) return;
        const line = await tx.folioLine.create({ data: {
          folioId: p.r.folio!.id, type: "MISC", description: p.description, quantity: 1, unitPaise: p.pre, amountPaise: BigInt(p.pre),
          taxRateBps: BPS, cgstPaise: p.cgst, sgstPaise: p.sgst, igstPaise: 0, hsnSac: "996311",
          placeOfSupplyState: p.r.property.state, businessDate: p.businessDate,
        }, select: { id: true } });
        await writeAudit(tx, {
          action: "folio:retain-credit", entityType: "FolioLine", entityId: line.id, propertyId: p.r.propertyId,
          reason: "Client decision 16 Nov 2026: the hotel kept money received above the bill",
          after: { reservation: p.r.code, amountPaise: p.keep },
        });
      });
    });
  }
  const stillMinus = (await prisma.folio.findMany({ where: { id: { in: plan.map((p) => p.r.folio!.id) } }, select: { lines: true, payments: true } }))
    .filter((f) => Number(folioBalance(f.lines, f.payments)) < 0).length;
  console.log(`✅ Applied. Still minus: ${stillMinus}. Void & revise the invoices listed above in the app.`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
