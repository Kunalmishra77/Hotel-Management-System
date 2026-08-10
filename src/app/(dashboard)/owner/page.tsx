import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, ArrowRight, BedDouble, CalendarClock, IndianRupee, LineChart, Percent, Receipt, TrendingUp, Wallet } from "lucide-react";
import { requirePermission } from "@/lib/auth/guard";
import { ownerFinancials, listOwnerPayouts, ownerSchedule, listOwnerDocuments } from "@/features/owner-portal/queries";
import { listAccessibleProperties } from "@/features/platform/actions";
import { KpiCard } from "@/components/ui/kpi-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { TrendChart } from "@/components/ui/charts/trend-chart";
import { formatINR } from "@/lib/utils";

export const metadata: Metadata = { title: "Owner home" };

const pct = (bps: number) => `${(bps / 100).toFixed(0)}%`;
const fmtDate = (d: Date | string) => new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });

/**
 * 27 owner-portal — the owner's home: a full performance dashboard for their
 * property (revenue/expense/profit/occupancy + 30-day trend), the latest payout,
 * upcoming renewals, and the document vault at a glance. `owner:view-financials`
 * gates the route; every figure comes from the canonical reports layer.
 */
export default async function OwnerHomePage() {
  const user = await requirePermission("owner:view-financials");
  const propertyId = user.activePropertyId;

  if (!propertyId) {
    return (
      <div className="p-4">
        <p className="text-sm text-muted-foreground">Select a property to see its performance.</p>
      </div>
    );
  }

  const today = new Date();
  const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const trendFrom = new Date(today.getTime() - 29 * 86_400_000);

  const [mtd, revTrend, payouts, schedule, documents, properties] = await Promise.all([
    ownerFinancials(user, { propertyId, from: monthStart, to: today }),
    ownerFinancials(user, { propertyId, from: trendFrom, to: today }),
    listOwnerPayouts(user, { propertyId }),
    ownerSchedule(user, { propertyId, from: trendFrom, to: today }),
    listOwnerDocuments(user, { propertyId }),
    listAccessibleProperties(),
  ]);

  const b = mtd.breakdown;
  const trendData = revTrend.trend.map((p) => ({ label: p.businessDate, value: p.value }));
  const propertyName = properties.find((p) => p.id === propertyId)?.name ?? "Your property";
  const latestPayout = payouts[0] ?? null;
  const upcoming = [...schedule.importantDates].sort((a, z) => new Date(a.dueDate).getTime() - new Date(z.dueDate).getTime()).slice(0, 4);
  const avgOcc = schedule.occupancy.length
    ? Math.round(schedule.occupancy.reduce((s, o) => s + o.occupancyBps, 0) / schedule.occupancy.length / 100)
    : 0;

  return (
    <div className="mx-auto w-full max-w-6xl">
      <PageHeader title="Owner home" description={`${propertyName} · month to date`} />

      {/* KPI row */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6" data-testid="owner-kpis">
        <KpiCard label="Revenue (MTD)" value={formatINR(b.revenuePaise)} icon={<IndianRupee />} />
        <KpiCard label="Expenses (MTD)" value={formatINR(b.expensePaise)} icon={<Wallet />} />
        <KpiCard label="Profit (MTD)" value={formatINR(b.profitPaise)} icon={<TrendingUp />} trend={b.profitPaise >= 0 ? "up" : "down"} delta={b.profitPaise >= 0 ? "In profit" : "In loss"} />
        <KpiCard label="Occupancy" value={pct(mtd.metrics.occupancyBps)} icon={<Percent />} hint="Room-nights" />
        <KpiCard label="ADR" value={formatINR(mtd.metrics.adrPaise)} icon={<BedDouble />} hint="Avg room rate" />
        <KpiCard label="RevPAR" value={formatINR(mtd.metrics.revparPaise)} icon={<LineChart />} />
      </div>

      {/* Trend + money flow */}
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2"><CardTitle className="text-base">Revenue — last 30 days</CardTitle></CardHeader>
          <CardContent><TrendChart data={trendData} format="inr" /></CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">This month</CardTitle></CardHeader>
          <CardContent>
            <dl className="space-y-2.5 text-sm">
              <Row label="Revenue" value={formatINR(b.revenuePaise)} />
              <Row label="Operating expenses" value={`− ${formatINR(b.expensePaise)}`} muted />
              <div className="flex items-center justify-between border-t pt-2.5 font-semibold">
                <dt>Profit</dt>
                <dd className={b.profitPaise < 0 ? "text-destructive" : "text-success"}>{formatINR(b.profitPaise)}</dd>
              </div>
              <p className="pt-1 text-xs text-muted-foreground">Avg occupancy this period: <span className="font-medium text-foreground">{avgOcc}%</span></p>
            </dl>
          </CardContent>
        </Card>
      </div>

      {/* Payout · Renewals · Documents */}
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        {/* Latest payout */}
        <Card>
          <CardHeader className="flex-row items-center justify-between pb-2">
            <CardTitle className="text-base">Latest payout</CardTitle>
            <Link href="/owner/payouts" className="text-xs font-medium text-primary hover:underline">All <ArrowRight className="inline size-3" /></Link>
          </CardHeader>
          <CardContent>
            {latestPayout ? (
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">{latestPayout.period}</p>
                <p className={`text-2xl font-semibold tabular ${latestPayout.netPayablePaise < 0 ? "text-destructive" : ""}`}>{formatINR(latestPayout.netPayablePaise)}</p>
                <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${latestPayout.status === "PAID" ? "bg-success/12 text-success" : "bg-warning/12 text-warning"}`}>
                  {latestPayout.status === "PAID" ? "Paid" : "Computed"}
                </span>
              </div>
            ) : (
              <p className="flex items-center gap-2 text-sm text-muted-foreground"><Receipt className="size-4" /> No payout recorded yet.</p>
            )}
          </CardContent>
        </Card>

        {/* Upcoming renewals */}
        <Card>
          <CardHeader className="flex-row items-center justify-between pb-2">
            <CardTitle className="text-base">Upcoming renewals</CardTitle>
            <Link href="/owner/schedule" className="text-xs font-medium text-primary hover:underline">Schedule <ArrowRight className="inline size-3" /></Link>
          </CardHeader>
          <CardContent>
            {upcoming.length ? (
              <ul className="space-y-2 text-sm">
                {upcoming.map((it) => (
                  <li key={it.id} className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate">{it.label} <span className="text-xs text-muted-foreground">· {it.kind}</span></span>
                    <span className={`shrink-0 text-xs ${it.overdue ? "font-medium text-destructive" : "text-muted-foreground"}`}>
                      {it.overdue ? <AlertTriangle className="mr-0.5 inline size-3" /> : null}{fmtDate(it.dueDate)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="flex items-center gap-2 text-sm text-muted-foreground"><CalendarClock className="size-4" /> No dates scheduled.</p>
            )}
          </CardContent>
        </Card>

        {/* Documents */}
        <Card>
          <CardHeader className="flex-row items-center justify-between pb-2">
            <CardTitle className="text-base">Documents</CardTitle>
            <Link href="/owner/documents" className="text-xs font-medium text-primary hover:underline">Open <ArrowRight className="inline size-3" /></Link>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold tabular">{documents.length}</p>
            <p className="text-sm text-muted-foreground">agreements, licences &amp; statements in your vault</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={muted ? "text-muted-foreground tabular" : "font-medium tabular"}>{value}</dd>
    </div>
  );
}
