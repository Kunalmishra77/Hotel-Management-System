import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/guard";
import { profitReport, revenueSegments } from "@/features/reports/queries";
import { ProfitReportView } from "@/features/reports/components/profit-report-view";

export const metadata: Metadata = { title: "Reports" };

/** 08 T-7/T-8 — the profit report for the active property, current month (FR-1/3/5). */
export default async function ReportsPage() {
  const user = await requirePermission("report:view-financial");
  const propertyId = user.activePropertyId ?? user.accessiblePropertyIds[0];
  if (!propertyId) {
    return <div className="p-4"><p className="text-sm text-muted-foreground">Select a property to see reports.</p></div>;
  }

  const now = new Date();
  const month = now.toISOString().slice(0, 7);
  const from = new Date(`${month}-01T00:00:00.000Z`);
  const to = new Date(now.toISOString().slice(0, 10) + "T00:00:00.000Z");

  const [report, segments] = await Promise.all([
    profitReport(user, { propertyIds: [propertyId], from, to }),
    revenueSegments(user, { propertyIds: [propertyId], from, to }),
  ]);

  return <ProfitReportView month={month} report={report} segments={segments} />;
}
