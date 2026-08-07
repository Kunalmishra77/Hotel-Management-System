import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/guard";
import { profitReport, revenueSegments } from "@/features/reports/queries";
import { listAccessibleProperties } from "@/features/platform/actions";
import { ProfitReportView } from "@/features/reports/components/profit-report-view";
import { ReportsFilterBar } from "@/features/reports/components/reports-filter-bar";

export const metadata: Metadata = { title: "Reports" };

const MONTH_RE = /^\d{4}-\d{2}$/;

function monthEnd(month: string): Date {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y!, m!, 0)); // day 0 of the next month = last day of `month`
}

/** 08 — profit report: income vs expense, occupancy/ADR/RevPAR, segments; for a
 *  chosen month + property set (defaults to the current month, all accessible). */
export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; properties?: string }>;
}) {
  const user = await requirePermission("report:view-financial");
  const properties = await listAccessibleProperties();
  if (properties.length === 0) {
    return (
      <div className="p-4">
        <p className="text-sm text-muted-foreground">No properties are assigned to you.</p>
      </div>
    );
  }
  const accessibleIds = properties.map((p) => p.id);

  const sp = await searchParams;
  const now = new Date();
  const currentMonth = now.toISOString().slice(0, 7);
  const month = sp.month && MONTH_RE.test(sp.month) ? sp.month : currentMonth;

  const requested = (sp.properties?.split(",").filter(Boolean) ?? []).filter((id) => accessibleIds.includes(id));
  const propertyIds = requested.length > 0 ? requested : accessibleIds;

  const from = new Date(`${month}-01T00:00:00.000Z`);
  const to =
    month === currentMonth ? new Date(now.toISOString().slice(0, 10) + "T00:00:00.000Z") : monthEnd(month);

  const [report, segments] = await Promise.all([
    profitReport(user, { propertyIds, from, to }),
    revenueSegments(user, { propertyIds, from, to }),
  ]);

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 p-4">
      <ReportsFilterBar properties={properties} selected={propertyIds} month={month} />
      <ProfitReportView month={month} report={report} segments={segments} propertyCount={propertyIds.length} />
    </div>
  );
}
