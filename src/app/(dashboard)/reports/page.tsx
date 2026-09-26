import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/guard";
import { hasPermission } from "@/lib/permissions";
import { NoProperty } from "@/features/platform/components/no-property";
import { profitReport, revenueSegments } from "@/features/reports/queries";
import { listAccessibleProperties } from "@/features/platform/actions";
import { ProfitReportView } from "@/features/reports/components/profit-report-view";
import { ReportsFilterBar } from "@/features/reports/components/reports-filter-bar";
import { ExportReportButton } from "@/features/reports/components/export-report-button";

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
    return <NoProperty what="This page" canCreate={hasPermission(user, "property:manage")} />;
  }
  const accessibleIds = properties.map((p) => p.id);

  const sp = await searchParams;
  const now = new Date();
  const currentMonth = now.toISOString().slice(0, 7);
  const month = sp.month && MONTH_RE.test(sp.month) ? sp.month : currentMonth;

  // Explicit ?properties= wins; otherwise follow the top-bar property selector
  // (activePropertyId) so Reports scopes with the rest of the app, falling back to
  // all accessible properties in "All hotels" mode.
  const requested = (sp.properties?.split(",").filter(Boolean) ?? []).filter((id) => accessibleIds.includes(id));
  const defaultIds = user.activePropertyId && accessibleIds.includes(user.activePropertyId) ? [user.activePropertyId] : accessibleIds;
  const propertyIds = requested.length > 0 ? requested : defaultIds;

  const from = new Date(`${month}-01T00:00:00.000Z`);
  const to =
    month === currentMonth ? new Date(now.toISOString().slice(0, 10) + "T00:00:00.000Z") : monthEnd(month);

  const [report, segments] = await Promise.all([
    profitReport(user, { propertyIds, from, to }),
    revenueSegments(user, { propertyIds, from, to }),
  ]);

  const scopeLabel =
    propertyIds.length === 1
      ? (properties.find((p) => p.id === propertyIds[0])?.name ?? "1 property")
      : `All properties (${propertyIds.length})`;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ReportsFilterBar properties={properties} selected={propertyIds} month={month} />
        <ExportReportButton month={month} scopeLabel={scopeLabel} report={report} segments={segments} />
      </div>
      <ProfitReportView month={month} report={report} segments={segments} propertyCount={propertyIds.length} />
    </div>
  );
}
