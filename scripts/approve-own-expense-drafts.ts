/**
 * One-time (30 Oct 2026): apply the "an approver's own entry is approved" rule to
 * the expenses entered before it existed. 452 entries sat in DRAFT — every one
 * entered by the Administrator, who may approve them — so none counted in reports
 * or profit (₹42.5 lakh, Apr–Oct). Each draft is approved only if its CREATOR holds
 * the approval permission for that property and amount (same check as on entry);
 * possible double entries (same property, day, amount and text) stay pending for
 * the client to confirm. Event + audit per expense.
 *   npx tsx scripts/approve-own-expense-drafts.ts                      (dry-run)
 *   $env:CONFIRM="YES"; npx tsx scripts/approve-own-expense-drafts.ts  (apply)
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { assembleClaims, type SessionClaims } from "../src/lib/auth/claims";
import { can } from "../src/lib/permissions";
import { requiresSuperApproval } from "../src/features/expenses/domain/escalation";

const APPLY = process.env.CONFIRM === "YES";
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } } });
const inr = (p: bigint | number) => `₹${(Number(p) / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

async function main() {
  const drafts = await prisma.expense.findMany({
    where: { status: "DRAFT" },
    select: { id: true, propertyId: true, amountPaise: true, spentOn: true, description: true, head: true, createdById: true },
    orderBy: { spentOn: "asc" },
  });
  // Possible double entries: same property, day, amount, text and head — larger than
  // a petty sum (two ₹31 milk packets on one day are normal; two ₹33,000 payments aren't).
  const key = (e: (typeof drafts)[number]) => `${e.propertyId}|${e.spentOn.toISOString().slice(0, 10)}|${e.amountPaise}|${(e.description ?? "").trim().toLowerCase()}|${e.head}`;
  const groups = new Map<string, typeof drafts>();
  for (const e of drafts) groups.set(key(e), [...(groups.get(key(e)) ?? []), e]);
  const suspect = new Set([...groups.values()].filter((g) => g.length > 1 && BigInt(g[0]!.amountPaise) >= 100_000n).flat().map((e) => e.id));

  const claims = new Map<string, SessionClaims | null>();
  const approve: typeof drafts = [];
  const notCreatorApprovable: typeof drafts = [];
  for (const e of drafts) {
    if (suspect.has(e.id)) continue;
    if (!e.createdById) { notCreatorApprovable.push(e); continue; }
    if (!claims.has(e.createdById)) claims.set(e.createdById, await assembleClaims(prisma, e.createdById));
    const c = claims.get(e.createdById);
    const ok = c && can(c, requiresSuperApproval(Number(e.amountPaise)) ? "expense:approve-large" : "expense:approve", e.propertyId);
    (ok ? approve : notCreatorApprovable).push(e);
  }
  const sum = (xs: typeof drafts) => xs.reduce((s, e) => s + BigInt(e.amountPaise), 0n);
  console.log(`DRAFT expenses: ${drafts.length} (${inr(sum(drafts))})`);
  console.log(`  approve (entered by an approver): ${approve.length} (${inr(sum(approve))})`);
  console.log(`  keep pending — possible double entry: ${suspect.size}`);
  for (const id of suspect) { const e = drafts.find((x) => x.id === id)!; console.log(`     ${e.spentOn.toISOString().slice(0, 10)} ${inr(e.amountPaise)} ${e.head} "${e.description ?? ""}"`); }
  console.log(`  keep pending — creator can't approve it: ${notCreatorApprovable.length}`);
  if (!APPLY) { console.log("\nDRY RUN — nothing written. Re-run with CONFIRM=YES to apply."); return; }

  const orgs = new Map((await prisma.property.findMany({ select: { id: true, orgId: true } })).map((p) => [p.id, p.orgId]));
  for (let i = 0; i < approve.length; i += 50) {
    const batch = approve.slice(i, i + 50);
    await prisma.$transaction(async (tx) => {
      for (const e of batch) {
        const n = await tx.expense.updateMany({ where: { id: e.id, status: "DRAFT" }, data: { status: "APPROVED", approvedById: e.createdById } });
        if (n.count !== 1) continue;
        const orgId = orgs.get(e.propertyId)!;
        await tx.domainEvent.create({ data: { orgId, propertyId: e.propertyId, type: "ExpenseApproved", aggregateId: e.id, payload: { selfApproved: true, backfill: true } } });
        await tx.auditLog.create({ data: { orgId, propertyId: e.propertyId, userId: e.createdById, action: "expense:approve", entityType: "Expense", entityId: e.id, reason: "Entered by an approver — approved per the 30 Oct 2026 rule (one-time backfill, client request) — script", before: { status: "DRAFT" }, after: { status: "APPROVED" } } });
      }
    }, { maxWait: 20_000, timeout: 120_000 });
  }
  const left = await prisma.expense.groupBy({ by: ["status"], _count: { _all: true }, _sum: { amountPaise: true } });
  console.log(`\n✅ Done. Now: ${left.map((g) => `${g.status} ${g._count._all} (${inr(g._sum.amountPaise ?? 0n)})`).join(" · ")}`);
}
main().catch((e) => { console.error("Failed:", e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
