/**
 * Expense rollup — 07 T-3 (FR-5, AC-5). Pure aggregation reused by 08/14.
 * Groups approved expenses by day / month / head / property and sums paise.
 * Property-local dates are already `@db.Date` (UTC midnight), so grouping by
 * their UTC calendar parts is correct and DST-immune.
 */
export type RollupExpense = {
  propertyId: string;
  head: string;
  spentOn: Date;
  amountPaise: number;
};

export type RollupKey = "day" | "month" | "head" | "property";

function ymd(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function keyFor(e: RollupExpense, groupBy: RollupKey): string {
  switch (groupBy) {
    case "day": return ymd(e.spentOn);
    case "month": return ymd(e.spentOn).slice(0, 7);
    case "head": return e.head;
    case "property": return e.propertyId;
  }
}

/** Totals (paise) grouped by the chosen key. */
export function rollup(expenses: RollupExpense[], groupBy: RollupKey): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of expenses) {
    const k = keyFor(e, groupBy);
    out[k] = (out[k] ?? 0) + e.amountPaise;
  }
  return out;
}

/** Grand total (paise) across the given expenses. */
export function totalPaise(expenses: RollupExpense[]): number {
  return expenses.reduce((sum, e) => sum + e.amountPaise, 0);
}
