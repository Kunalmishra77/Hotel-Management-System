/**
 * Visual expense breakdown (Phase-3 ⑦) — three views of the same approved-only
 * spend the ledger below totals: by category, by property, and a month-by-month
 * trend. Category/property bars are pure server-rendered share bars (fixed hue per
 * category, so a colour always means the same head); the trend reuses the house
 * TrendChart. Numbers reconcile with `expensePortfolio` (APPROVED only).
 */
import { EXPENSE_HEAD_LABEL } from "@/lib/constants/company";
import { formatINR } from "@/lib/utils";
import { TrendChart, type TrendPoint } from "@/components/ui/charts/trend-chart";
import type { ExpensePortfolio } from "../queries";

// Fixed head → hue so a colour reads the same across every screen. 7 heads, 6 hues:
// MISC borrows the neutral muted tone (it's the catch-all, never a headline).
const HEAD_HUE: Record<string, string> = {
  HOUSEKEEPING: "var(--chart-1)",
  KITCHEN: "var(--chart-3)",
  MAINTENANCE: "var(--chart-6)",
  UTILITIES: "var(--chart-4)",
  STAFF: "var(--chart-2)",
  ADMINISTRATION: "var(--chart-5)",
  MISC: "var(--muted-foreground)",
};

const headLabel = (h: string): string => EXPENSE_HEAD_LABEL[h as keyof typeof EXPENSE_HEAD_LABEL] ?? h;

/** Month buckets (YYYY-MM-01) from approved rows → the TrendChart's point shape. */
function monthlyTrend(rows: ExpensePortfolio["rows"]): TrendPoint[] {
  const byMonth = new Map<string, number>();
  for (const r of rows) {
    if (r.status !== "APPROVED") continue;
    const d = new Date(r.spentOn);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
    byMonth.set(key, (byMonth.get(key) ?? 0) + r.amountPaise);
  }
  return [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([label, value]) => ({ label, value }));
}

function ShareBars({
  title,
  rows,
  hueOf,
}: {
  title: string;
  rows: { key: string; label: string; totalPaise: number }[];
  hueOf: (key: string) => string;
}) {
  const grand = rows.reduce((n, r) => n + r.totalPaise, 0);
  const max = rows.reduce((n, r) => Math.max(n, r.totalPaise), 0) || 1;
  return (
    <div className="rounded-lg border p-3">
      <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</p>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No approved spend.</p>
      ) : (
        <ul className="space-y-2.5">
          {rows.map((r) => {
            const share = grand > 0 ? Math.round((r.totalPaise / grand) * 100) : 0;
            return (
              <li key={r.key} className="space-y-1">
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="flex items-center gap-2">
                    <span className="inline-block size-2.5 shrink-0 rounded-sm" style={{ background: `hsl(${hueOf(r.key)})` }} aria-hidden />
                    {r.label}
                  </span>
                  <span className="tabular text-muted-foreground">{formatINR(r.totalPaise)} <span className="text-xs">· {share}%</span></span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full" style={{ width: `${Math.max((r.totalPaise / max) * 100, 2)}%`, background: `hsl(${hueOf(r.key)})` }} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function ExpensesCharts({ data }: { data: ExpensePortfolio }) {
  const trend = monthlyTrend(data.rows);
  return (
    <div className="space-y-3">
      <div className="grid gap-3 lg:grid-cols-2">
        <ShareBars
          title="By category"
          rows={data.byHead.map((h) => ({ key: h.head, label: headLabel(h.head), totalPaise: h.totalPaise }))}
          hueOf={(k) => HEAD_HUE[k] ?? "var(--chart-1)"}
        />
        <ShareBars
          title="By property"
          rows={data.byProperty.map((p) => ({ key: p.propertyId, label: p.propertyName, totalPaise: p.totalPaise }))}
          hueOf={() => "var(--chart-1)"}
        />
      </div>
      <div className="rounded-lg border p-3">
        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Spend trend (monthly, approved)</p>
        <TrendChart data={trend} format="inr" height={200} emptyLabel="No approved spend in this range yet." />
      </div>
    </div>
  );
}
