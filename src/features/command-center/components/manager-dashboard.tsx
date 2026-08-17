import Link from "next/link";
import {
  Gauge, ChartColumn, ClipboardCheck, CalendarDays, Users, Percent, IndianRupee,
  TrendingUp, BedDouble, LineChart as LineChartIcon, Wallet, ArrowRight, Inbox,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { KpiCard } from "@/components/ui/kpi-card";
import { TrendChart } from "@/components/ui/charts/trend-chart";
import { PortfolioGrid } from "./portfolio-grid";
import type { Portfolio } from "../queries";
import type { PendingApproval } from "@/features/expenses/queries";

const inr = (p: number) => `₹${Math.round(p / 100).toLocaleString("en-IN")}`;
const pct = (bps: number) => `${Math.round(bps / 100)}%`;

/**
 * Manager command centre — monitoring, analytics and approvals, NOT the front
 * desk's operational board. Portfolio KPIs (occupancy / revenue / profit / ADR /
 * RevPAR), a revenue trend, a sign-off queue, and a multi-property comparison.
 * This is the Manager portal's distinct identity, branched by resolvePortal().
 */
export function ManagerDashboard({
  name,
  propertyCount,
  portfolio,
  revenueTrend,
  approvals,
  pendingDuesPaise,
  activePropertyId,
  canApprove,
}: {
  name: string;
  propertyCount: number;
  portfolio: Portfolio;
  revenueTrend: { label: string; value: number }[];
  approvals: PendingApproval[];
  pendingDuesPaise: number;
  activePropertyId: string | null;
  canApprove: boolean;
}) {
  const t = portfolio.totals;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Manager — welcome, ${name}`}
        description={`Monitoring ${propertyCount} propert${propertyCount === 1 ? "y" : "ies"} · month to date`}
      />

      {/* Monitoring / control actions */}
      <div className="flex flex-wrap gap-2">
        <Button asChild size="lg"><Link href="/overview"><Gauge /><span className="ml-1.5">Command centre</span></Link></Button>
        <Button asChild size="lg" variant="outline"><Link href="/reports"><ChartColumn /><span className="ml-1.5">Reports</span></Link></Button>
        {canApprove ? <Button asChild size="lg" variant="outline"><Link href="/approvals"><ClipboardCheck /><span className="ml-1.5">Approvals</span></Link></Button> : null}
        <Button asChild size="lg" variant="outline"><Link href="/bookings"><CalendarDays /><span className="ml-1.5">Bookings</span></Link></Button>
        <Button asChild size="lg" variant="outline"><Link href="/staff"><Users /><span className="ml-1.5">Staff</span></Link></Button>
      </div>

      {/* Portfolio KPI band */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <KpiCard label="Occupancy" value={pct(t.occupancyBps)} icon={<Percent />} hint="Month to date" href="/overview" />
        <KpiCard label="Revenue" value={inr(t.revenuePaise)} icon={<IndianRupee />} hint="Month to date" href="/reports" />
        <KpiCard label="Profit" value={inr(t.profitPaise)} icon={<TrendingUp />} goodDirection="up" hint="Income − expenses" href="/reports" />
        <KpiCard label="ADR" value={inr(t.adrPaise)} icon={<BedDouble />} hint="Avg room rate" href="/overview" />
        <KpiCard label="RevPAR" value={inr(t.revparPaise)} icon={<LineChartIcon />} hint="Per available room" href="/overview" />
        <KpiCard label="Pending approvals" value={approvals.length} icon={<ClipboardCheck />} hint="Awaiting sign-off" href="/approvals" className={approvals.length > 0 ? "border-warning/40" : undefined} />
      </div>

      {/* Revenue trend + approvals queue */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-base">Revenue — last 14 days</CardTitle>
            <Link href="/reports" className="inline-flex items-center gap-1 text-sm font-medium text-primary underline-offset-4 hover:underline">
              Reports <ArrowRight className="size-3.5" aria-hidden="true" />
            </Link>
          </CardHeader>
          <CardContent>
            {revenueTrend.length > 0 ? (
              <TrendChart data={revenueTrend} format="inr" height={200} />
            ) : (
              <p className="py-12 text-center text-sm text-muted-foreground">No revenue in range yet.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="flex items-center gap-2 text-base [&_svg]:size-4 [&_svg]:text-primary"><ClipboardCheck /> To approve</CardTitle>
            {approvals.length > 0 ? (
              <Link href="/approvals" className="text-sm font-medium text-primary underline-offset-4 hover:underline">All</Link>
            ) : null}
          </CardHeader>
          <CardContent className="pt-0">
            {approvals.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                <Inbox className="mx-auto size-5" aria-hidden="true" />
                <p className="mt-2">Nothing awaiting sign-off.</p>
              </div>
            ) : (
              <ul className="divide-y">
                {approvals.slice(0, 5).map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{a.vendor ?? a.head}</div>
                      <div className="text-xs text-muted-foreground">{a.head}</div>
                    </div>
                    <span className="shrink-0 tabular font-semibold">{inr(a.amountPaise)}</span>
                  </li>
                ))}
              </ul>
            )}
            {pendingDuesPaise > 0 ? (
              <Link href="/billing" className="mt-3 flex items-center justify-between rounded-lg border bg-muted/30 px-3 py-2 text-sm transition hover:border-primary/40">
                <span className="inline-flex items-center gap-1.5 text-muted-foreground"><Wallet className="size-4" aria-hidden="true" /> Pending dues</span>
                <span className="tabular font-semibold">{inr(pendingDuesPaise)}</span>
              </Link>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {/* Multi-property comparison */}
      {portfolio.properties.length > 1 ? (
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="text-base">Properties</CardTitle>
            <Link href="/overview" className="inline-flex items-center gap-1 text-sm font-medium text-primary underline-offset-4 hover:underline">
              Command centre <ArrowRight className="size-3.5" aria-hidden="true" />
            </Link>
          </CardHeader>
          <CardContent>
            <PortfolioGrid properties={portfolio.properties} activePropertyId={activePropertyId} />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
