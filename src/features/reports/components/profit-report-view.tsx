/**
 * Profit report view — 08 T-7/T-8 (AC-1/4/5). Presentational, server-rendered.
 * Income vs expense (revenue by category, expenses by head + once-counted staff
 * cost, profit), 14's occupancy/ADR/RevPAR, revenue by source, and top corporates.
 * Financial page (guarded by report:view-financial).
 */
import { BreakdownList } from "@/components/ui/charts/breakdown-list";
import type { ProfitReport, RevenueSegments } from "../queries";

const rupees = (p: number) => `₹${(p / 100).toLocaleString("en-IN")}`;
const pct = (bps: number) => `${(bps / 100).toFixed(0)}%`;

const SOURCE_LABEL: Record<string, string> = {
  WALK_IN: "Walk-in",
  DIRECT: "Direct",
  WEBSITE: "Website",
  PHONE: "Phone",
  CORPORATE: "Corporate",
  TRAVEL_AGENT: "Travel agent",
  BOOKING_COM: "Booking.com",
  MAKEMYTRIP: "MakeMyTrip",
  GOIBIBO: "Goibibo",
  AGODA: "Agoda",
  AIRBNB: "Airbnb",
};
const sourceLabel = (s: string) => SOURCE_LABEL[s] ?? s.replace(/_/g, " ").toLowerCase();

export function ProfitReportView({
  month,
  report,
  segments,
  propertyCount = 1,
}: {
  month: string;
  report: ProfitReport;
  segments: RevenueSegments;
  propertyCount?: number;
}) {
  const b = report.breakdown;
  return (
    <div className="space-y-4" data-testid="profit-report">
      <div>
        <h1 className="text-xl font-semibold">Profit · {month}</h1>
        <p className="text-sm text-muted-foreground">
          {propertyCount > 1 ? `Consolidated across ${propertyCount} properties` : "Income vs expense"}
        </p>
      </div>

      <section className="space-y-1 rounded-md border p-4 text-sm">
        <Row label="Revenue" value={rupees(b.revenuePaise)} strong testid="report-revenue" />
        {Object.entries(b.revenueByCategory)
          .filter(([, v]) => v !== 0)
          .map(([cat, v]) => (
            <Row key={cat} label={`  ${cat}`} value={rupees(v)} muted />
          ))}
        <Row label="Expenses" value={rupees(b.expensePaise)} strong testid="report-expenses" />
        {Object.entries(b.expenseByHead).map(([head, v]) => (
          <Row key={head} label={`  ${head}`} value={rupees(v)} muted />
        ))}
        <Row label="  Staff (payroll)" value={rupees(b.staffCostPaise)} muted />
        <div className="my-1 border-t" />
        <Row label="Profit" value={rupees(b.profitPaise)} strong testid="report-profit" />
      </section>

      <section className="grid grid-cols-3 gap-3 text-sm">
        <Stat label="Occupancy" value={pct(report.metrics.occupancyBps)} />
        <Stat label="ADR" value={rupees(report.metrics.adrPaise)} />
        <Stat label="RevPAR" value={rupees(report.metrics.revparPaise)} />
      </section>

      <section className="rounded-md border p-4">
        <h2 className="mb-3 text-sm font-semibold">Revenue by source</h2>
        <div data-testid="segment-source">
          <BreakdownList
            items={segments.bySource.map((s) => ({ label: sourceLabel(s.source), value: s.revenuePaise }))}
            emptyLabel="No bookings in this range."
          />
        </div>
      </section>

      {segments.corporates.length > 0 ? (
        <section className="rounded-md border p-4">
          <h2 className="mb-3 text-sm font-semibold">Top corporate clients</h2>
          <div data-testid="segment-corporates">
            <BreakdownList
              items={segments.corporates.slice(0, 6).map((c) => ({ label: c.name, value: c.revenuePaise }))}
            />
          </div>
        </section>
      ) : null}
    </div>
  );
}

function Row({
  label,
  value,
  strong,
  muted,
  testid,
}: {
  label: string;
  value: string;
  strong?: boolean;
  muted?: boolean;
  testid?: string;
}) {
  return (
    <div className={`flex justify-between ${strong ? "font-semibold" : ""} ${muted ? "text-muted-foreground" : ""}`}>
      <span>{label}</span>
      <span data-testid={testid}>{value}</span>
    </div>
  );
}
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
    </div>
  );
}
