/**
 * Expense queries — 07 T-6 (FR-5, AC-5). `expenseRollup` filters `status=APPROVED`
 * (the reporting rule 08/14 rely on — DRAFT/REJECTED never count toward profit)
 * and delegates the maths to the pure `rollup` domain fn. Callers pass claims.
 */
import { db } from "@/lib/db";
import { rollup, totalPaise, type RollupKey } from "./domain/rollup";
import { requiresSuperApproval } from "./domain/escalation";
import type { SessionClaims } from "@/lib/auth/claims";

export type PendingApproval = {
  id: string;
  head: string;
  subCategory: string | null;
  amountPaise: number;
  spentOn: Date;
  vendor: string | null;
  propertyId: string;
  propertyName: string;
  needsSuperApproval: boolean;
};

/**
 * Cross-property expense-approval queue (architecture v2 · Super Admin/Manager
 * Approvals). Every DRAFT expense awaiting approval across the caller's accessible
 * properties, flagged with whether it needs Super-Admin (large) approval.
 */
export async function listPendingApprovals(user: SessionClaims): Promise<PendingApproval[]> {
  const ids = [...user.accessiblePropertyIds];
  if (ids.length === 0) return [];
  const rows = await db.scoped(user).expense.findMany({
    where: { propertyId: { in: ids }, status: "DRAFT" },
    select: { id: true, head: true, subCategory: true, amountPaise: true, spentOn: true, vendor: true, propertyId: true },
    orderBy: { spentOn: "desc" },
    take: 200,
  });
  if (rows.length === 0) return [];
  const props = await db.unscoped().property.findMany({
    where: { id: { in: [...new Set(rows.map((r) => r.propertyId))] } },
    select: { id: true, name: true },
  });
  const nameById = new Map(props.map((p) => [p.id, p.name]));
  return rows.map((r) => ({
    id: r.id,
    head: r.head,
    subCategory: r.subCategory,
    amountPaise: r.amountPaise,
    spentOn: r.spentOn,
    vendor: r.vendor,
    propertyId: r.propertyId,
    propertyName: nameById.get(r.propertyId) ?? r.propertyId,
    needsSuperApproval: requiresSuperApproval(r.amountPaise),
  }));
}

export type ExpenseListItem = {
  id: string;
  head: string;
  subCategory: string | null;
  amountPaise: number;
  spentOn: Date;
  status: string;
  vendor: string | null;
  hasBill: boolean;
};

/**
 * Expense search — the 15-search federation shard for expenses (15 FR-1/2).
 * Keyword matches `vendor` OR `subCategory`; property-scoped, cursor-paginated.
 */
export async function searchExpenses(
  user: SessionClaims,
  input: { keyword?: string; propertyId?: string; cursor?: string; limit?: number },
): Promise<{ expenses: ExpenseListItem[]; nextCursor: string | null }> {
  const limit = input.limit ?? 25;
  const kw = input.keyword?.trim();
  const rows = await db.scoped(user).expense.findMany({
    where: {
      ...(input.propertyId ? { propertyId: input.propertyId } : {}),
      ...(kw
        ? {
            OR: [
              { vendor: { contains: kw, mode: "insensitive" } },
              { subCategory: { contains: kw, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    select: { id: true, head: true, subCategory: true, amountPaise: true, spentOn: true, status: true, vendor: true, billObjectKey: true },
    orderBy: [{ spentOn: "desc" }, { id: "asc" }],
    take: limit + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  return {
    expenses: page.map((r) => ({
      id: r.id, head: r.head, subCategory: r.subCategory, amountPaise: r.amountPaise,
      spentOn: r.spentOn, status: r.status, vendor: r.vendor, hasBill: r.billObjectKey !== null,
    })),
    nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
  };
}

/** Approved-expense rollup for a property set + date range (FR-5). For 08/14. */
export async function expenseRollup(
  user: SessionClaims,
  input: { propertyIds: string[]; from: Date; to: Date; groupBy: RollupKey },
): Promise<{ totals: Record<string, number>; totalPaise: number }> {
  const rows = await db.scoped(user).expense.findMany({
    where: { propertyId: { in: input.propertyIds }, status: "APPROVED", spentOn: { gte: input.from, lte: input.to } },
    select: { propertyId: true, head: true, spentOn: true, amountPaise: true },
  });
  return { totals: rollup(rows, input.groupBy), totalPaise: totalPaise(rows) };
}

/** List expenses for a property (approval queue / ledger), optionally by status. */
export async function listExpenses(
  user: SessionClaims,
  input: { propertyId: string; status?: string; limit?: number },
): Promise<ExpenseListItem[]> {
  const rows = await db.scoped(user).expense.findMany({
    where: { propertyId: input.propertyId, ...(input.status ? { status: input.status as never } : {}) },
    select: { id: true, head: true, subCategory: true, amountPaise: true, spentOn: true, status: true, vendor: true, billObjectKey: true },
    orderBy: { spentOn: "desc" },
    take: input.limit ?? 100,
  });
  return rows.map((r) => ({
    id: r.id, head: r.head, subCategory: r.subCategory, amountPaise: r.amountPaise,
    spentOn: r.spentOn, status: r.status, vendor: r.vendor, hasBill: r.billObjectKey !== null,
  }));
}
