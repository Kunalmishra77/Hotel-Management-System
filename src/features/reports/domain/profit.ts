/**
 * Profit-report domain — 08 T-1 (FR-1/3/6, AC-1/8/9). Pure. Reuses 14's `profit`
 * (no divergent math); adds the staff-cost apportionment and the income/expense
 * breakdown.
 *
 * Staff cost is counted ONCE — from finalized payroll (21), apportioned evenly
 * across a month's days for daily/partial-range views; a full month reconciles
 * back to the finalized net. The 07 expense side NEVER includes staff salary
 * (reporting.md).
 */
import Decimal from "decimal.js";

/** Even daily apportionment: monthlyNet ÷ daysInMonth × rangeDays (paise, half-up). */
export function apportionStaffCost(monthlyNetPaise: number, daysInMonth: number, rangeDays: number): number {
  if (daysInMonth <= 0) return 0;
  return new Decimal(monthlyNetPaise).div(daysInMonth).times(rangeDays).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
}

export type Breakdown = {
  revenuePaise: number;
  revenueByCategory: Record<string, number>;
  expensePaise: number;
  expenseByHead: Record<string, number>;
  staffCostPaise: number;
  profitPaise: number;
};

/**
 * Assemble the income-vs-expense breakdown. `expenseByHead` is 07 heads only;
 * `staffCost` (the apportioned 21 term) is added to the expense total exactly
 * once and is never folded into `expenseByHead` (FR-3/6).
 */
export function incomeVsExpense(
  revenueByCategory: Record<string, number>,
  expenseByHead: Record<string, number>,
  staffCostPaise: number,
): Breakdown {
  const revenuePaise = Object.values(revenueByCategory).reduce((a, b) => a + b, 0);
  const expense07 = Object.values(expenseByHead).reduce((a, b) => a + b, 0);
  const expensePaise = expense07 + staffCostPaise;
  return {
    revenuePaise,
    revenueByCategory,
    expensePaise,
    expenseByHead,
    staffCostPaise,
    profitPaise: revenuePaise - expensePaise,
  };
}
