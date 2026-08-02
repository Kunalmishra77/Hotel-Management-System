import type { Metadata } from "next";
import { hasPermission } from "@/lib/permissions";
import { requirePermission } from "@/lib/auth/guard";
import { listExpenses, expenseRollup } from "@/features/expenses/queries";
import { ExpensesScreen } from "@/features/expenses/components/expenses-screen";

export const metadata: Metadata = { title: "Expenses" };

/** 07 T-9/T-10 — expense entry + approval queue (FR-1/4/5, AC-1/4/5). */
export default async function ExpensesPage() {
  const user = await requirePermission("expense:create");
  const propertyId = user.activePropertyId;
  if (!propertyId) {
    return <div className="p-4"><p className="text-sm text-muted-foreground">Select a property to manage expenses.</p></div>;
  }

  // spentOn is a date-only column (UTC midnight); bound the day at midnight so a
  // `new Date()` time component doesn't exclude today's entries.
  const dayStr = new Date().toISOString().slice(0, 10);
  const from = new Date(`${dayStr}T00:00:00.000Z`);
  const to = new Date(`${dayStr}T23:59:59.999Z`);
  const [expenses, roll] = await Promise.all([
    listExpenses(user, { propertyId, limit: 50 }),
    expenseRollup(user, { propertyIds: [propertyId], from, to, groupBy: "day" }),
  ]);

  return (
    <ExpensesScreen
      propertyId={propertyId}
      expenses={expenses}
      canApprove={hasPermission(user, "expense:approve")}
      todayTotalPaise={roll.totalPaise}
    />
  );
}
