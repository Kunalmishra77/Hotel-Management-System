/**
 * Expense queries — 07 T-6 (FR-5, AC-5). `expenseRollup` filters `status=APPROVED`
 * (the reporting rule 08/14 rely on — DRAFT/REJECTED never count toward profit)
 * and delegates the maths to the pure `rollup` domain fn. Callers pass claims.
 */
import { db } from "@/lib/db";
import { rollup, totalPaise, type RollupKey } from "./domain/rollup";
import type { SessionClaims } from "@/lib/auth/claims";

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
