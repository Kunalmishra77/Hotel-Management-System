/**
 * Profit report view — 08 T-7/T-8 (AC-1/4/5). Presentational, server-rendered.
 * Revenue by category, expenses by head + the once-counted staff cost, profit,
 * and 14's occupancy/ADR/RevPAR. Financial page (guarded by report:view-financial).
 */
import type { ProfitReport, RevenueSegments } from "../queries";

const rupees = (p: number) => `₹${(p / 100).toLocaleString("en-IN")}`;
const pct = (bps: number) => `${(bps / 100).toFixed(0)}%`;

export function ProfitReportView({
  month,
  report,
  segments,
}: {
  month: string;
  report: ProfitReport;
  segments: RevenueSegments;
}) {
  const b = report.breakdown;
  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 p-4" data-testid="profit-report">
      <h1 className="text-xl font-semibold">Profit · {month}</h1>

      <section className="space-y-1 rounded-md border p-4 text-sm">
        <Row label="Revenue" value={rupees(b.revenuePaise)} strong testid="report-revenue" />
        {Object.entries(b.revenueByCategory).filter(([, v]) => v !== 0).map(([cat, v]) => (
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

      {segments.corporates.length > 0 && (
        <section className="rounded-md border p-4">
          <h2 className="mb-2 text-sm font-semibold">Top corporates</h2>
          <ul className="space-y-1 text-sm" data-testid="segment-corporates">
            {segments.corporates.slice(0, 5).map((c) => (
              <li key={c.id} className="flex justify-between"><span>{c.name}</span><span className="text-muted-foreground">{rupees(c.revenuePaise)} · {c.roomNights} nights</span></li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Row({ label, value, strong, muted, testid }: { label: string; value: string; strong?: boolean; muted?: boolean; testid?: string }) {
  return (
    <div className={`flex justify-between ${strong ? "font-semibold" : ""} ${muted ? "text-muted-foreground" : ""}`}>
      <span>{label}</span><span data-testid={testid}>{value}</span>
    </div>
  );
}
function Stat({ label, value }: { label: string; value: string }) {
  return <div className="rounded-md border p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="text-lg font-semibold">{value}</p></div>;
}
