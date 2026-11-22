/**
 * One bill, one number — fold past void chains (specs/06 FR-RV-4, client 22 Nov 2026).
 *
 * Before 22 Nov a correction was "credit note + new invoice", so a guest's bill
 * went 685 → (CN 1043) → 1044. This folds each chain back to ONE number: the live
 * bill is re-issued as the next REVISION of its chain's ORIGINAL number and date
 * (same lines, same totals, same bill-to), and the old original, its credit note
 * and the old re-issue are marked superseded (write-once — nothing deleted or
 * edited). Totals per period are unchanged: superseded rows net to the same money
 * as the new revision.
 *  - Split stay: the guest's DIRECT bill takes the original number; OTA copies keep theirs.
 *  - Duplicate live bills for one bill part: the first keeps the number, the rest are superseded by it.
 * Idempotent (a folio that already has a superseded row is skipped). PDFs render on first download.
 *
 *   npx tsx scripts/fold-invoice-revisions.ts               (dry run)
 *   CONFIRM=YES npx tsx scripts/fold-invoice-revisions.ts   (apply)
 *   SINCE=2026-11-01 …  only chains whose every invoice is on/after that India-time
 *   date — i.e. months whose GST return is not filed yet (a fold re-dates the bill
 *   to its original date, which changes an already-filed month: CA's call).
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.env.CONFIRM === "YES";
const SINCE = process.env.SINCE ? new Date(`${process.env.SINCE}T00:00:00+05:30`) : null;

type Inv = Awaited<ReturnType<typeof load>>[number];
async function load() {
  return prisma.invoice.findMany({
    orderBy: { issuedAt: "asc" },
    include: { lines: { orderBy: { sortOrder: "asc" } } },
  });
}
const seq = (n: string) => n.replace("WASPL :", "").replace(/\/ \d\d-\d\d$/, "");

async function main() {
  const all = await load();
  const orgOf = new Map((await prisma.property.findMany({ select: { id: true, orgId: true } })).map((p) => [p.id, p.orgId]));
  const byFolio = new Map<string, Inv[]>();
  for (const i of all) byFolio.set(i.folioId, [...(byFolio.get(i.folioId) ?? []), i]);

  type Plan = { kind: "fold"; live: Inv; root: Inv; supersede: Inv[] } | { kind: "dup"; keep: Inv; supersede: Inv[] };
  const plans: Plan[] = [];
  for (const rows of byFolio.values()) {
    if (rows.some((r) => r.supersededById)) continue;
    const creditOf = new Map(rows.filter((r) => r.cancelsInvoiceId).map((r) => [r.cancelsInvoiceId!, r]));
    const tis = rows.filter((r) => r.type === "TAX_INVOICE");
    const voided = tis.filter((r) => creditOf.has(r.id));
    const live = tis.filter((r) => !creditOf.has(r.id));
    // Duplicates: >1 live bill for the same part → keep the first.
    const byPart = new Map<string, Inv[]>();
    for (const l of live) byPart.set(l.billPart ?? "ALL", [...(byPart.get(l.billPart ?? "ALL") ?? []), l]);
    const lives: Inv[] = [];
    for (const group of byPart.values()) {
      lives.push(group[0]!);
      if (group.length > 1) plans.push({ kind: "dup", keep: group[0]!, supersede: group.slice(1) });
    }
    if (voided.length === 0) continue;
    // Guest's Direct bill first, so it gets the original number on a split stay.
    lives.sort((a, b) => (a.billPart === "DIRECT" ? -1 : 0) - (b.billPart === "DIRECT" ? -1 : 0));
    const used = new Set<string>();
    for (const l of lives) {
      const own = voided.filter((v) => !used.has(v.id) && (v.billPart === null || v.billPart === l.billPart));
      if (own.length === 0) continue;
      own.forEach((v) => used.add(v.id));
      const root = own[0]!;
      if (root.number === l.number) continue;
      const supersede = [...new Map([l, ...own, ...own.map((v) => creditOf.get(v.id)).filter((x): x is Inv => !!x)].map((x) => [x.id, x])).values()];
      plans.push({ kind: "fold", live: l, root, supersede });
    }
  }

  const touched = (p: Plan) => (p.kind === "fold" ? [p.live, p.root, ...p.supersede] : [p.keep, ...p.supersede]);
  const held = SINCE ? plans.filter((p) => touched(p).some((i) => i.issuedAt < SINCE)) : [];
  if (SINCE) {
    for (const p of held) console.log(`HELD  ${p.kind === "fold" ? `${seq(p.live.number)} → ${seq(p.root.number)}` : `dup ${seq(p.keep.number)}`} · ${p.kind === "fold" ? p.live.customerName : p.keep.customerName} (touches a month before ${process.env.SINCE})`);
    plans.splice(0, plans.length, ...plans.filter((p) => !held.includes(p)));
  }
  for (const p of plans) {
    if (p.kind === "fold") console.log(`fold  ${seq(p.live.number).padStart(5)}${p.live.billPart ? `[${p.live.billPart}]` : ""} → ${seq(p.root.number)} (dated ${p.root.issuedAt.toISOString().slice(0, 10)}) ₹${Number(p.live.totalPaise) / 100} · ${p.live.customerName} · supersedes ${p.supersede.map((s) => seq(s.number)).join(",")}`);
    else console.log(`dup   keep ${seq(p.keep.number)} · supersede ${p.supersede.map((s) => seq(s.number)).join(",")} · ${p.keep.customerName}`);
  }
  const freed = plans.flatMap((p) => (p.kind === "fold" ? [p.live, ...p.supersede.filter((s) => s.type === "CREDIT_NOTE")] : p.supersede)).map((s) => seq(s.number));
  console.log(`\n${plans.filter((p) => p.kind === "fold").length} bills get their original number back; ${plans.filter((p) => p.kind === "dup").length} duplicate sets. Numbers no longer in use: ${[...new Set(freed)].join(", ")}`);
  if (!APPLY) { console.log("\nDRY RUN — nothing written. Re-run with CONFIRM=YES to apply."); return; }

  for (const p of plans) {
    await prisma.$transaction(async (tx) => {
      const orgId = orgOf.get(p.kind === "fold" ? p.live.propertyId : p.keep.propertyId)!;
      if (p.kind === "dup") {
        await tx.invoice.updateMany({ where: { id: { in: p.supersede.map((s) => s.id) }, supersededById: null }, data: { supersededById: p.keep.id, supersededAt: new Date() } });
        await tx.auditLog.create({ data: { orgId, propertyId: p.keep.propertyId, action: "invoice:fold-duplicates", entityType: "Invoice", entityId: p.keep.id, reason: "One bill, one number (client, 22 Nov 2026) — duplicate live bills folded", after: { kept: p.keep.number, superseded: p.supersede.map((s) => s.number) } } });
        return;
      }
      const { live, root } = p;
      const top = await tx.invoice.aggregate({ where: { number: root.number, propertyId: root.propertyId }, _max: { revision: true } });
      const created = await tx.invoice.create({
        data: {
          propertyId: root.propertyId, folioId: live.folioId, number: root.number, revision: (top._max.revision ?? 0) + 1,
          financialYear: root.financialYear, type: "TAX_INVOICE", billPart: live.billPart, customerName: live.customerName,
          customerGstin: live.customerGstin, customerAddress: live.customerAddress, customerState: live.customerState,
          customerPhone: live.customerPhone, guestName: live.guestName, placeOfSupply: live.placeOfSupply,
          taxableValuePaise: live.taxableValuePaise, cgstPaise: live.cgstPaise, sgstPaise: live.sgstPaise, igstPaise: live.igstPaise,
          totalPaise: live.totalPaise, issuedAt: root.issuedAt, issuedById: live.issuedById, pdfObjectKey: null,
          lines: { create: live.lines.map((l) => ({ type: l.type, description: l.description, quantity: l.quantity, unitPaise: l.unitPaise, amountPaise: l.amountPaise, taxRateBps: l.taxRateBps, cgstPaise: l.cgstPaise, sgstPaise: l.sgstPaise, igstPaise: l.igstPaise, hsnSac: l.hsnSac, sortOrder: l.sortOrder })) },
        },
        select: { id: true },
      });
      const res = await tx.invoice.updateMany({ where: { id: { in: p.supersede.map((s) => s.id) }, supersededById: null }, data: { supersededById: created.id, supersededAt: new Date() } });
      if (res.count !== p.supersede.length) throw new Error(`race on ${live.number}`);
      await tx.auditLog.create({ data: { orgId, propertyId: root.propertyId, action: "invoice:fold-revision", entityType: "Invoice", entityId: created.id, reason: "One bill, one number (client, 22 Nov 2026) — void chain folded to the original number", after: { number: root.number, from: live.number, superseded: p.supersede.map((s) => s.number), totalPaise: Number(live.totalPaise) } } });
    });
  }
  console.log(`\nApplied ${plans.length} plans.`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
