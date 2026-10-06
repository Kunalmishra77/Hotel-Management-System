import type { Metadata } from "next";
import { NoProperty } from "@/features/platform/components/no-property";
import { hasPermission } from "@/lib/permissions";
import { requirePermission } from "@/lib/auth/guard";
import { listExpenses, expenseRollup, expensePortfolio, budgetVsActual } from "@/features/expenses/queries";
import { listProperties } from "@/features/properties/queries";
import { ExpensesScreen } from "@/features/expenses/components/expenses-screen";
import { ExpensesPortfolio } from "@/features/expenses/components/expenses-portfolio";
import { ExpensesBudget } from "@/features/expenses/components/expenses-budget";

export const metadata: Metadata = { title: "Expenses" };

const dayBound = (s: string | undefined, end: boolean): Date | undefined =>
  s ? new Date(`${s}T${end ? "23:59:59.999" : "00:00:00.000"}Z`) : undefined;

/** 07 T-9/T-10 — expense entry + approval queue (FR-1/4/5, AC-1/4/5) + the
 *  centralized cross-property ledger (client req #15/#19). */
export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requirePermission("expense:create");
  // The picker offers hotels AND cost-centres (A2 office / Woodpecker HO / Other),
  // so office/overhead expenses can be recorded; the form defaults to a HOTEL
  // (never a cost-centre, even though one may sort first by code).
  const pickerProperties = await listProperties(user, { includeCostCenters: true });
  const hotels = pickerProperties.filter((p) => !p.isCostCenter);
  const propertyId = user.activePropertyId ?? hotels[0]?.id ?? pickerProperties[0]?.id ?? null;
  if (!propertyId) {
    return <NoProperty what="This page" canCreate={hasPermission(user, "property:manage")} />;
  }

  const sp = await searchParams;
  const str = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;
  const filters = {
    propertyId: str(sp.property),
    head: str(sp.head),
    paidVia: str(sp.paidVia),
    from: str(sp.from),
    to: str(sp.to),
  };

  // spentOn is a date-only column (UTC midnight); bound the day at midnight so a
  // `new Date()` time component doesn't exclude today's entries.
  const dayStr = new Date().toISOString().slice(0, 10);
  const from = new Date(`${dayStr}T00:00:00.000Z`);
  const to = new Date(`${dayStr}T23:59:59.999Z`);
  const accessible = [...user.accessiblePropertyIds];
  // Budgets are per property: editable when one property is focused, else a
  // read-only portfolio aggregate. Current calendar month.
  const budgetMonth = dayStr.slice(0, 7);
  const budgetPropertyIds = user.activePropertyId ? [user.activePropertyId] : accessible;
  const [expenses, roll, portfolio, budget] = await Promise.all([
    listExpenses(user, { propertyId, limit: 50 }),
    expenseRollup(user, { propertyIds: [propertyId], from, to, groupBy: "day" }),
    expensePortfolio(user, {
      propertyIds: filters.propertyId ? [filters.propertyId] : accessible,
      head: filters.head,
      paidVia: filters.paidVia,
      from: dayBound(filters.from, false),
      to: dayBound(filters.to, true),
      // Higher cap so a full-month export isn't truncated (the ledger + its export
      // share these rows; a month across the small properties stays well under this).
      limit: 3000,
    }),
    budgetVsActual(user, { propertyIds: budgetPropertyIds, month: budgetMonth }),
  ]);

  return (
    <>
      <ExpensesScreen
        propertyId={propertyId}
        properties={pickerProperties.map((p) => ({ id: p.id, name: p.name }))}
        expenses={expenses}
        canApprove={hasPermission(user, "expense:approve")}
        todayTotalPaise={roll.totalPaise}
      />
      <div className="mx-auto w-full max-w-[1600px] px-4 pb-8">
        <ExpensesBudget
          rows={budget.rows}
          month={budget.month}
          totalBudgetPaise={budget.totalBudgetPaise}
          totalActualPaise={budget.totalActualPaise}
          editablePropertyId={hasPermission(user, "expense:approve") ? user.activePropertyId : null}
        />
        <ExpensesPortfolio
          data={portfolio}
          properties={pickerProperties.map((p) => ({ id: p.id, name: p.name }))}
          filters={filters}
        />
      </div>
    </>
  );
}
