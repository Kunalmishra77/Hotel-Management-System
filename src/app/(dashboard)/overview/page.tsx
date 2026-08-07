import type { Metadata } from "next";
import { BedDouble, IndianRupee, LineChart, Percent, TrendingUp, Wallet } from "lucide-react";
import { requirePermission } from "@/lib/auth/guard";
import { liveTiles, perPropertyStats, trend } from "@/features/analytics/queries";
import { profitReport, revenueSegments } from "@/features/reports/queries";
import { KpiCard } from "@/components/ui/kpi-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
 * 14/08 — Manager overview: KPIs, revenue trend, and revenue segmentation
 * CONSOLIDATED across every property the manager can access (not just the active
 * one). Financial, so `report:view-financial` gates the whole route.
 */
export default async function OverviewPage() {
  const user = await requirePermission("report:view-financial");
  const propertyIds = user.accessiblePropertyIds;

  const today = new Date();
  const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const trendFrom = new Date(today.getTime() - 29 * 86_400_000);

  const [tiles, profit, revTrend, segs, perProperty] = await Promise.all([
    liveTiles(user, propertyIds),
    profitReport(user, { propertyIds, from: monthStart, to: today }),
    trend(user, { metric: "revenue", from: trendFrom, to: today, propertyIds }),
    revenueSegments(user, { propertyIds, from: monthStart, to: today }),
    propertyIds.length > 1
      ? perPropertyStats(user, { propertyIds, from: monthStart, to: today })
      : Promise.resolve([]),
  ]);

  const b = profit.breakdown;
  const trendData = revTrend.map((p) => ({ label: p.businessDate, value: p.value }));
  const propertyCount = propertyIds.length;

  return (
    <div className="mx-auto w-full max-w-5xl">
      <PageHeader
        title="Overview"
        description={
          propertyCount > 1
            ? `Consolidated across ${propertyCount} properties · month to date`
            : "Month to date"
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3" data-testid="overview-kpis">
        <KpiCard label="Occupancy (live)" value={pct(tiles.occupancyBps)} icon={<Percent />} hint="Current status" />
        <KpiCard label="Revenue (MTD)" value={formatINR(b.revenuePaise)} icon={<IndianRupee />} />
        <KpiCard
          label="Profit (MTD)"
          value={formatINR(b.profitPaise)}
          icon={<TrendingUp />}
          trend={b.profitPaise >= 0 ? "up" : "down"}
          delta={b.profitPaise >= 0 ? "In profit" : "In loss"}
        />
        <KpiCard label="ADR (MTD)" value={formatINR(profit.metrics.adrPaise)} icon={<BedDouble />} hint="Room rate" />
        <KpiCard label="RevPAR (MTD)" value={formatINR(profit.metrics.revparPaise)} icon={<LineChart />} />
        <KpiCard label="Pending dues" value={formatINR(tiles.pendingPaise ?? 0)} icon={<Wallet />} hint="Unsettled folios" />
      </div>

      <Card className="mt-4">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Revenue — last 30 days</CardTitle>
        </CardHeader>
        <CardContent>
          <TrendChart data={trendData} format="inr" />
        </CardContent>
      </Card>

      {perProperty.length > 0 ? (
        <Card className="mt-4">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">By property (month to date)</CardTitle>
          </CardHeader>
          <CardContent className="px-0">
            <div className="overflow-x-auto">
              <Table data-testid="per-property">
                <TableHeader>
                  <TableRow>
                    <TableHead>Property</TableHead>
                    <TableHead className="text-right">Occ.</TableHead>
                    <TableHead className="text-right">ADR</TableHead>
                    <TableHead className="text-right">RevPAR</TableHead>
                    <TableHead className="text-right">Revenue</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {perProperty.map((p) => (
                    <TableRow key={p.propertyId}>
                      <TableCell className="font-medium">{p.name}</TableCell>
                      <TableCell className="text-right tabular">{pct(p.occupancyBps)}</TableCell>
                      <TableCell className="text-right tabular">{formatINR(p.adrPaise)}</TableCell>
                      <TableCell className="text-right tabular">{formatINR(p.revparPaise)}</TableCell>
                      <TableCell className="text-right font-medium tabular">{formatINR(p.revenuePaise)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      ) : null}

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
