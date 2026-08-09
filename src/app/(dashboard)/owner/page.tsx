import type { Metadata } from "next";
import { BedDouble, IndianRupee, LineChart, Percent, TrendingUp, Wallet } from "lucide-react";
import { requirePermission } from "@/lib/auth/guard";
import { ownerFinancials } from "@/features/owner-portal/queries";
import { KpiCard } from "@/components/ui/kpi-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { TrendChart } from "@/components/ui/charts/trend-chart";
import { formatINR } from "@/lib/utils";

export const metadata: Metadata = { title: "Owner home" };

const pct = (bps: number) => `${(bps / 100).toFixed(0)}%`;

/**
 * 27 owner-portal — the owner's home: revenue/expense/profit/occupancy for their
 * property, month to date, + a 30-day revenue trend. `owner:view-financials`
 * gates the route; numbers come from the canonical reports layer (never recomputed).
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

  const [mtd, revTrend] = await Promise.all([
    ownerFinancials(user, { propertyId, from: monthStart, to: today }),
    ownerFinancials(user, { propertyId, from: trendFrom, to: today }),
  ]);

  const b = mtd.breakdown;
  const trendData = revTrend.trend.map((p) => ({ label: p.businessDate, value: p.value }));

  return (
    <div className="mx-auto w-full max-w-4xl">
      <PageHeader title="Owner home" description="Your property's performance, month to date." />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3" data-testid="owner-kpis">
        <KpiCard label="Revenue (MTD)" value={formatINR(b.revenuePaise)} icon={<IndianRupee />} />
        <KpiCard label="Expenses (MTD)" value={formatINR(b.expensePaise)} icon={<Wallet />} />
        <KpiCard
          label="Profit (MTD)"
          value={formatINR(b.profitPaise)}
          icon={<TrendingUp />}
          trend={b.profitPaise >= 0 ? "up" : "down"}
          delta={b.profitPaise >= 0 ? "In profit" : "In loss"}
        />
        <KpiCard label="Occupancy" value={pct(mtd.metrics.occupancyBps)} icon={<Percent />} hint="Room-nights" />
        <KpiCard label="ADR" value={formatINR(mtd.metrics.adrPaise)} icon={<BedDouble />} hint="Avg room rate" />
        <KpiCard label="RevPAR" value={formatINR(mtd.metrics.revparPaise)} icon={<LineChart />} />
      </div>

      <Card className="mt-4">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Revenue — last 30 days</CardTitle>
        </CardHeader>
        <CardContent>
          <TrendChart data={trendData} format="inr" />
        </CardContent>
      </Card>
    </div>
  );
}
