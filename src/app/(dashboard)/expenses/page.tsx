import type { Metadata } from "next";
import { NoProperty } from "@/features/platform/components/no-property";
import { hasPermission } from "@/lib/permissions";
import { requirePermission } from "@/lib/auth/guard";
import { listExpenses, expenseRollup, expensePortfolio } from "@/features/expenses/queries";
import { listProperties } from "@/features/properties/queries";
import { ExpensesScreen } from "@/features/expenses/components/expenses-screen";
import { ExpensesPortfolio } from "@/features/expenses/components/expenses-portfolio";

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
  // "All hotels" scope (activePropertyId null) still shows the centralized ledger;
  // the entry form defaults to the first accessible property (multi-property users
  // pick the property in the form itself).
  const propertyId = user.activePropertyId ?? user.accessiblePropertyIds[0] ?? null;
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
  const [expenses, roll, properties, portfolio] = await Promise.all([
    listExpenses(user, { propertyId, limit: 50 }),
    expenseRollup(user, { propertyIds: [propertyId], from, to, groupBy: "day" }),
    listProperties(user),
    expensePortfolio(user, {
      propertyIds: filters.propertyId ? [filters.propertyId] : accessible,
      head: filters.head,
      paidVia: filters.paidVia,
      from: dayBound(filters.from, false),
      to: dayBound(filters.to, true),
    }),
  ]);

  return (
    <>
      <ExpensesScreen
        propertyId={propertyId}
        properties={properties.map((p) => ({ id: p.id, name: p.name }))}
        expenses={expenses}
        canApprove={hasPermission(user, "expense:approve")}
        todayTotalPaise={roll.totalPaise}
      />
      <div className="mx-auto w-full max-w-6xl px-4 pb-8">
        <ExpensesPortfolio
          data={portfolio}
          properties={properties.map((p) => ({ id: p.id, name: p.name }))}
          filters={filters}
        />
      </div>
    </>
  );
}
