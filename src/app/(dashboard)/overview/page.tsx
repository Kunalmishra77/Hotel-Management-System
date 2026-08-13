import type { Metadata } from "next";
import { BedDouble, Building2, IndianRupee, LineChart, Percent, TrendingUp, Wallet } from "lucide-react";
import { requirePermission } from "@/lib/auth/guard";
import { liveTiles, trend } from "@/features/analytics/queries";
import { revenueSegments } from "@/features/reports/queries";
import { getPortfolio } from "@/features/command-center/queries";
import { PortfolioGrid } from "@/features/command-center/components/portfolio-grid";
import { KpiCard } from "@/components/ui/kpi-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { TrendChart } from "@/components/ui/charts/trend-chart";
import { BreakdownList } from "@/components/ui/charts/breakdown-list";
import { formatINR } from "@/lib/utils";

export const metadata: Metadata = { title: "Overview" };

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
const pct = (bps: number) => `${(bps / 100).toFixed(0)}%`;

/**
 * 14/08 — Manager / Super-Admin command centre: consolidated KPIs, revenue trend,
 * revenue segmentation, AND a per-property portfolio grid across every property the
 * caller can access. For an org-wide admin this is the "see all my hotels from one
 * place" screen with one-tap drill-in; for a single-property manager it collapses to
 * that property's numbers. Financial, so `report:view-financial` gates the route.
 */
export default async function OverviewPage() {
  const user = await requirePermission("report:view-financial");
  const propertyIds = user.accessiblePropertyIds;

  const today = new Date();
  const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const trendFrom = new Date(today.getTime() - 29 * 86_400_000);

  const [tiles, portfolio, revTrend, segs] = await Promise.all([
    liveTiles(user, propertyIds),
    getPortfolio(user, monthStart, today),
    trend(user, { metric: "revenue", from: trendFrom, to: today, propertyIds }),
    revenueSegments(user, { propertyIds, from: monthStart, to: today }),
  ]);

  const t = portfolio.totals;
  const trendData = revTrend.map((p) => ({ label: p.businessDate, value: p.value }));
  const isPortfolio = portfolio.properties.length > 1;

  return (
    <div className="mx-auto w-full max-w-6xl">
      <PageHeader
        title="Command centre"
        description={
          isPortfolio
            ? `${t.count} properties · one dashboard · month to date`
            : "Month to date"
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6" data-testid="overview-kpis">
        <KpiCard label="Occupancy (live)" value={pct(tiles.occupancyBps)} icon={<Percent />} hint="Current status" />
        <KpiCard label="Revenue (MTD)" value={formatINR(t.revenuePaise)} icon={<IndianRupee />} />
        <KpiCard
          label="Profit (MTD)"
          value={formatINR(t.profitPaise)}
          icon={<TrendingUp />}
          trend={t.profitPaise >= 0 ? "up" : "down"}
          delta={t.profitPaise >= 0 ? "In profit" : "In loss"}
        />
        <KpiCard label="ADR (MTD)" value={formatINR(t.adrPaise)} icon={<BedDouble />} hint="Room rate" />
        <KpiCard label="RevPAR (MTD)" value={formatINR(t.revparPaise)} icon={<LineChart />} />
        <KpiCard label="Pending dues" value={formatINR(tiles.pendingPaise ?? 0)} icon={<Wallet />} hint="Unsettled folios" />
      </div>

      {isPortfolio ? (
        <div className="mt-5">
          <div className="mb-2.5 flex items-center gap-2">
            <Building2 className="size-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">Your properties</h2>
            <span className="text-xs text-muted-foreground">tap a hotel to focus the whole app on it</span>
          </div>
          <PortfolioGrid properties={portfolio.properties} activePropertyId={user.activePropertyId} />
        </div>
      ) : null}

      <Card className="mt-5">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Revenue — last 30 days</CardTitle>
        </CardHeader>
        <CardContent>
          <TrendChart data={trendData} format="inr" />
        </CardContent>
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Revenue by source</CardTitle>
          </CardHeader>
          <CardContent>
            <BreakdownList
              items={segs.bySource.map((s) => ({ label: sourceLabel(s.source), value: s.revenuePaise }))}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Top corporate clients</CardTitle>
          </CardHeader>
          <CardContent>
            <BreakdownList
              items={segs.corporates.slice(0, 6).map((c) => ({ label: c.name, value: c.revenuePaise }))}
              emptyLabel="No corporate bookings this month."
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
