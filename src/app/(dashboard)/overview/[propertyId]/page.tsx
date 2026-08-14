import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, BedDouble, Building2, IndianRupee, LineChart, Percent, User, Wallet } from "lucide-react";
import { requirePermission } from "@/lib/auth/guard";
import { parsePeriod, periodRange, PERIODS, PERIOD_LABEL } from "@/features/command-center/domain/period";
import { liveTiles, trend } from "@/features/analytics/queries";
import { revenueSegments } from "@/features/reports/queries";
import { getPortfolio } from "@/features/command-center/queries";
import { KpiCard } from "@/components/ui/kpi-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { TrendChart } from "@/components/ui/charts/trend-chart";
import { BreakdownList } from "@/components/ui/charts/breakdown-list";
import { formatINR } from "@/lib/utils";

export const metadata: Metadata = { title: "Property view" };

const pct = (bps: number) => `${(bps / 100).toFixed(0)}%`;
const SOURCE_LABEL: Record<string, string> = {
  WALK_IN: "Walk-in", DIRECT: "Direct", WEBSITE: "Website", PHONE: "Phone", CORPORATE: "Corporate",
  TRAVEL_AGENT: "Travel agent", BOOKING_COM: "Booking.com", MAKEMYTRIP: "MakeMyTrip", GOIBIBO: "Goibibo", AGODA: "Agoda", AIRBNB: "Airbnb",
};
const sourceLabel = (s: string) => SOURCE_LABEL[s] ?? s.replace(/_/g, " ").toLowerCase();

/**
 * Super Admin · Property View Mode (architecture v2 · Phase 2). A READ-ONLY
 * executive view of one hotel, opened from the command centre. Operational work
 * stays in that property's own portal — this page only monitors. "◀ All hotels"
 * returns to the consolidated command centre.
 */
export default async function PropertyViewPage({
  params,
  searchParams,
}: {
  params: Promise<{ propertyId: string }>;
  searchParams: Promise<{ period?: string }>;
}) {
  const { propertyId } = await params;
  const user = await requirePermission("report:view-financial", propertyId);
  if (!user.accessiblePropertyIds.includes(propertyId)) notFound();

  const today = new Date();
  const period = parsePeriod((await searchParams).period);
  const { from, label: periodLabel } = periodRange(period, today);
  const ids = [propertyId];

  const [tiles, portfolio, revTrend, segs] = await Promise.all([
    liveTiles(user, ids),
    getPortfolio(user, from, today),
    trend(user, { metric: "revenue", from, to: today, propertyIds: ids }),
    revenueSegments(user, { propertyIds: ids, from, to: today }),
  ]);
  const p = portfolio.properties.find((x) => x.id === propertyId);
  if (!p) notFound();

  const qs = (period: string) => (period === "30d" ? `/overview/${propertyId}` : `/overview/${propertyId}?period=${period}`);

  return (
    <div className="mx-auto w-full max-w-6xl">
      <Link
        href="/overview"
        className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        <ArrowLeft className="size-3.5" aria-hidden="true" /> All hotels
      </Link>

      <PageHeader
        title={
          <span className="inline-flex items-center gap-2">
            <Building2 className="size-5 text-primary" aria-hidden="true" />
            {p.name}
          </span>
        }
        description={
          <span className="inline-flex items-center gap-2 text-sm">
            <span>{p.city} · {p.code}</span>
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium">Read-only executive view</span>
          </span>
        }
        actions={
          <div className="inline-flex items-center rounded-lg border bg-card p-0.5 text-sm" role="group" aria-label="Date range">
            {PERIODS.map((per) => (
              <Link
                key={per}
                href={qs(per)}
                className={
                  per === period
                    ? "rounded-md bg-primary px-2.5 py-1 font-medium text-primary-foreground"
                    : "rounded-md px-2.5 py-1 text-muted-foreground hover:text-foreground"
                }
              >
                {PERIOD_LABEL[per]}
              </Link>
            ))}
          </div>
        }
      >
        {p.managers.length > 0 ? (
          <p className="mt-2 inline-flex items-center gap-1.5 text-sm text-muted-foreground">
            <User className="size-4" aria-hidden="true" /> Manager: <span className="font-medium text-foreground">{p.managers.join(", ")}</span>
          </p>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">No manager assigned</p>
        )}
      </PageHeader>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <KpiCard label="Occupancy (live)" value={pct(tiles.occupancyBps)} icon={<Percent />} hint="Current status" />
        <KpiCard label="Revenue" value={formatINR(p.revenuePaise)} icon={<IndianRupee />} hint={periodLabel} />
        <KpiCard label="Occupancy (period)" value={pct(p.occupancyBps)} icon={<Percent />} />
        <KpiCard label="ADR" value={formatINR(p.adrPaise)} icon={<BedDouble />} hint="Room rate" />
        <KpiCard label="RevPAR" value={formatINR(p.revparPaise)} icon={<LineChart />} />
        <KpiCard label="Pending dues" value={formatINR(tiles.pendingPaise ?? 0)} icon={<Wallet />} hint="Unsettled folios" />
      </div>

      <Card className="mt-5">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Revenue — {periodLabel}</CardTitle>
        </CardHeader>
        <CardContent>
          <TrendChart data={revTrend.map((x) => ({ label: x.businessDate, value: x.value }))} format="inr" />
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Revenue by source</CardTitle>
        </CardHeader>
        <CardContent>
          <BreakdownList
            items={segs.bySource.map((s) => ({ label: sourceLabel(s.source), value: s.revenuePaise }))}
            emptyLabel="No revenue in this period."
          />
        </CardContent>
      </Card>

      <p className="mt-5 text-center text-xs text-muted-foreground">
        Read-only. Day-to-day operations for {p.name} are run by its Manager and department teams in their own portals.
      </p>
    </div>
  );
}
