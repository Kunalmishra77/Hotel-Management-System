import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import {
  BedDouble, IndianRupee, LineChart, Percent, TrendingUp, Wallet, Gauge, Trophy,
  TriangleAlert, ArrowRight, LogIn, LogOut, DoorOpen, CircleDollarSign,
  CalendarCheck, XCircle, UserX,
} from "lucide-react";
import { requirePermission } from "@/lib/auth/guard";
import {
  parsePeriod, periodRange, previousWindow, deltaPct,
} from "@/features/command-center/domain/period";
import { liveTiles, trend } from "@/features/analytics/queries";
import { revenueSegments } from "@/features/reports/queries";
import { getPortfolio, portfolioBookingCounts } from "@/features/command-center/queries";
import { PeriodFilter } from "@/features/command-center/components/period-filter";
import { PortfolioLeague } from "@/features/command-center/components/portfolio-league";
import { netAfterCommission } from "@/features/command-center/domain/commission";
import { KpiCard } from "@/components/ui/kpi-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { TrendChart } from "@/components/ui/charts/trend-chart";
import { BreakdownList } from "@/components/ui/charts/breakdown-list";
import { formatINR } from "@/lib/utils";

export const metadata: Metadata = { title: "Command centre" };

const SOURCE_LABEL: Record<string, string> = {
  WALK_IN: "Walk-in", DIRECT: "Direct", WEBSITE: "Website", PHONE: "Phone", CORPORATE: "Corporate",
  TRAVEL_AGENT: "Travel agent", BOOKING_COM: "Booking.com", MAKEMYTRIP: "MakeMyTrip", GOIBIBO: "Goibibo",
  AGODA: "Agoda", AIRBNB: "Airbnb",
};
const sourceLabel = (s: string) => SOURCE_LABEL[s] ?? s.replace(/_/g, " ").toLowerCase();
const pct = (bps: number) => `${Math.round(bps / 100)}%`;

// Channel families — direct earns full margin; OTA carries commission.
const DIRECT_SOURCES = new Set(["DIRECT", "WEBSITE", "PHONE", "WALK_IN"]);
const OTA_SOURCES = new Set(["BOOKING_COM", "MAKEMYTRIP", "GOIBIBO", "AGODA", "AIRBNB"]);
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** KpiCard delta props from a signed %-change; `goodDirection` colours it. */
function deltaProps(d: number | null, goodDirection: "up" | "down" = "up") {
  // No comparable prior window (previous ≈ 0), or a swing so large the % is noise
  // (e.g. first bookings in a fresh period) — show the value without a misleading delta.
  if (d === null || Math.abs(d) > 300) return { hint: "vs previous" };
  const trend = d > 0.5 ? ("up" as const) : d < -0.5 ? ("down" as const) : ("flat" as const);
  return { trend, delta: `${d > 0 ? "+" : ""}${d.toFixed(0)}%`, goodDirection, hint: "vs previous" };
}

/** GOPPAR = gross operating profit ÷ available room-nights (derived from RevPAR). */
const goppar = (profitPaise: number, revenuePaise: number, revparPaise: number) =>
  revenuePaise > 0 && revparPaise > 0 ? Math.round((profitPaise * revparPaise) / revenuePaise) : 0;

/**
 * Super-Admin / Manager command centre — the multi-property owner's home. A time
 * lens (today → year, custom) drives every number, each shown against the previous
 * equal window (▲▼). Portfolio KPIs incl. GOPPAR, revenue trend, a sortable
 * property league with best/worst spotlight, attention alerts, today's live board,
 * and revenue by source + corporate. `report:view-financial`.
 */
export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; from?: string; to?: string }>;
}) {
  const user = await requirePermission("report:view-financial");
  const propertyIds = user.accessiblePropertyIds;

  const today = new Date();
  const sp = await searchParams;
  const period = parsePeriod(sp.period);
  const win = periodRange(period, today, { from: sp.from, to: sp.to });
  const prev = previousWindow(win);

  const [tiles, portfolio, prevPortfolio, revTrend, segs, bookingCounts] = await Promise.all([
    liveTiles(user, propertyIds),
    getPortfolio(user, win.from, win.to),
    getPortfolio(user, prev.from, prev.to),
    trend(user, { metric: "revenue", from: win.from, to: win.to, propertyIds }),
    revenueSegments(user, { propertyIds, from: win.from, to: win.to }),
    portfolioBookingCounts(user, { propertyIds, from: win.from, to: win.to }),
  ]);

  const t = portfolio.totals;
  const p = prevPortfolio.totals;
  const trendData = revTrend.map((x) => ({ label: x.businessDate, value: x.value }));
  const isPortfolio = portfolio.properties.length > 1;

  const gopparNow = goppar(t.profitPaise, t.revenuePaise, t.revparPaise);
  const gopparPrev = goppar(p.profitPaise, p.revenuePaise, p.revparPaise);

  // Channel mix — direct vs OTA vs corporate/other, from the revenue-by-source split.
  const directRev = segs.bySource.filter((s) => DIRECT_SOURCES.has(s.source)).reduce((a, s) => a + s.revenuePaise, 0);
  const otaRev = segs.bySource.filter((s) => OTA_SOURCES.has(s.source)).reduce((a, s) => a + s.revenuePaise, 0);
  const otherRev = Math.max(0, t.revenuePaise - directRev - otaRev);
  const directRatio = t.revenuePaise > 0 ? Math.round((directRev / t.revenuePaise) * 100) : 0;
  const { commissionPaise: otaCommission, netPaise: netRevenue } = netAfterCommission(segs.bySource, t.revenuePaise);

  // Ranked league (by revenue) → best & worst spotlight.
  const ranked = [...portfolio.properties].sort((a, b) => b.revenuePaise - a.revenuePaise);
  const best = ranked[0];
  const worst = ranked[ranked.length - 1];

  // Derived attention alerts.
  const lowOcc = portfolio.properties.filter((x) => x.occupancyBps < 4000);
  const alerts: { tone: "warning" | "danger"; text: string; href: string }[] = [];
  if (t.profitPaise < 0) alerts.push({ tone: "danger", text: `Portfolio in loss (${formatINR(t.profitPaise)}) this period`, href: "/reports" });
  if ((tiles.pendingPaise ?? 0) > 0) alerts.push({ tone: "warning", text: `${formatINR(tiles.pendingPaise ?? 0)} in pending dues to collect`, href: "/billing" });
  if (lowOcc.length > 0) alerts.push({ tone: "warning", text: `${lowOcc.length} propert${lowOcc.length === 1 ? "y" : "ies"} below 40% occupancy`, href: "/insights" });

  return (
    <div className="mx-auto w-full max-w-6xl">
      <PageHeader
        title="Command centre"
        description={isPortfolio ? `${t.count} properties · one dashboard · ${win.label}` : win.label}
      />

      <div className="mt-1">
        <PeriodFilter period={period} from={iso(win.from)} to={iso(win.to)} />
      </div>

      {/* KPI band with period-over-period deltas */}
      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-4">
        <KpiCard label="Revenue" value={formatINR(t.revenuePaise)} icon={<IndianRupee />} {...deltaProps(deltaPct(t.revenuePaise, p.revenuePaise))} />
        <KpiCard label="Profit" value={formatINR(t.profitPaise)} icon={<TrendingUp />} {...deltaProps(deltaPct(t.profitPaise, p.profitPaise))} className={t.profitPaise < 0 ? "border-destructive/40" : undefined} />
        <KpiCard label="GOPPAR" value={formatINR(gopparNow)} icon={<CircleDollarSign />} {...deltaProps(deltaPct(gopparNow, gopparPrev))} />
        <KpiCard label="Occupancy" value={pct(t.occupancyBps)} icon={<Percent />} {...deltaProps(deltaPct(t.occupancyBps, p.occupancyBps))} />
        <KpiCard label="ADR" value={formatINR(t.adrPaise)} icon={<BedDouble />} {...deltaProps(deltaPct(t.adrPaise, p.adrPaise))} />
        <KpiCard label="RevPAR" value={formatINR(t.revparPaise)} icon={<LineChart />} {...deltaProps(deltaPct(t.revparPaise, p.revparPaise))} />
        <KpiCard label="Live occupancy" value={pct(tiles.occupancyBps)} icon={<Gauge />} hint="right now" href="/rooms" />
        <KpiCard label="Pending dues" value={formatINR(tiles.pendingPaise ?? 0)} icon={<Wallet />} hint="unsettled folios" href="/billing" className={(tiles.pendingPaise ?? 0) > 0 ? "border-warning/40" : undefined} />
        <KpiCard label="Bookings" value={bookingCounts.bookings} icon={<CalendarCheck />} hint="realised in range" />
        <KpiCard label="Cancellations" value={bookingCounts.cancelled} icon={<XCircle />} hint={`${bookingCounts.cancelRatePct}% cancel/no-show`} className={bookingCounts.cancelled > 0 ? "border-destructive/30" : undefined} />
        <KpiCard label="No-shows" value={bookingCounts.noShow} icon={<UserX />} hint="did not arrive" />
        <KpiCard label="Net revenue" value={formatINR(netRevenue)} icon={<CircleDollarSign />} hint="after OTA commission" />
      </div>

      {/* Revenue trend + today's live board */}
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2"><CardTitle className="text-base">Revenue — {win.label}</CardTitle></CardHeader>
          <CardContent>
            {trendData.length > 0 ? <TrendChart data={trendData} format="inr" height={200} /> : <p className="py-12 text-center text-sm text-muted-foreground">No revenue in range yet.</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Today, live</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <SnapshotRow icon={<LogIn className="size-4" />} label="Arrivals" value={tiles.arrivalsToday} href="/bookings" />
            <SnapshotRow icon={<LogOut className="size-4" />} label="Departures" value={tiles.departuresToday} href="/in-house" />
            <SnapshotRow icon={<DoorOpen className="size-4" />} label="Occupied" value={tiles.rooms.occupied} href="/rooms" />
            <SnapshotRow icon={<BedDouble className="size-4" />} label="Vacant" value={tiles.rooms.vacant} href="/rooms" />
          </CardContent>
        </Card>
      </div>

      {/* Best / worst spotlight + alerts */}
      {isPortfolio && best && worst ? (
        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          <Spotlight tone="good" title="Top performer" name={best.name} sub={`${formatINR(best.revenuePaise)} · ${pct(best.occupancyBps)} occ`} href={`/overview/${best.id}`} />
          <Spotlight tone="bad" title="Needs a push" name={worst.name} sub={`${formatINR(worst.revenuePaise)} · ${pct(worst.occupancyBps)} occ`} href={`/overview/${worst.id}`} />
          <Card>
            <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base [&_svg]:size-4 [&_svg]:text-warning"><TriangleAlert /> Attention</CardTitle></CardHeader>
            <CardContent className="pt-0">
              {alerts.length === 0 ? (
                <p className="py-4 text-sm text-muted-foreground">All clear — nothing needs your attention.</p>
              ) : (
                <ul className="space-y-2">
                  {alerts.map((a) => (
                    <li key={a.text}>
                      <Link href={a.href} className={`inline-flex items-center gap-1.5 text-sm font-medium underline-offset-4 hover:underline ${a.tone === "danger" ? "text-destructive" : "text-amber-700 dark:text-amber-400"}`}>
                        {a.text} <ArrowRight className="size-3.5" aria-hidden="true" />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      ) : null}

      {/* Property league */}
      {isPortfolio ? (
        <div className="mt-5">
          <div className="mb-2.5 flex items-center gap-2">
            <Trophy className="size-4 text-muted-foreground" aria-hidden="true" />
            <h2 className="text-sm font-semibold">Property league</h2>
            <span className="text-xs text-muted-foreground">sort any column · tap to drill in</span>
          </div>
          <PortfolioLeague properties={portfolio.properties} />
        </div>
      ) : null}

      {/* Channel mix + revenue by source + top corporates */}
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-baseline justify-between gap-2 text-base">
              Channel mix
              <span className="text-sm font-normal text-muted-foreground">{directRatio}% direct</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex h-2.5 overflow-hidden rounded-full bg-muted">
              {t.revenuePaise > 0 ? (
                <>
                  <div className="bg-success" style={{ width: `${(directRev / t.revenuePaise) * 100}%` }} title="Direct" />
                  <div className="bg-primary" style={{ width: `${(otaRev / t.revenuePaise) * 100}%` }} title="OTA" />
                  <div className="bg-[hsl(var(--brand-brass))]" style={{ width: `${(otherRev / t.revenuePaise) * 100}%` }} title="Corporate / other" />
                </>
              ) : null}
            </div>
            <ul className="space-y-1.5 text-sm">
              <li className="flex items-center justify-between"><span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-success" /> Direct</span><span className="tabular font-medium">{formatINR(directRev)}</span></li>
              <li className="flex items-center justify-between"><span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-primary" /> OTA (commissioned)</span><span className="tabular font-medium">{formatINR(otaRev)}</span></li>
              <li className="flex items-center justify-between"><span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-[hsl(var(--brand-brass))]" /> Corporate / other</span><span className="tabular font-medium">{formatINR(otherRev)}</span></li>
            </ul>
            <div className="border-t pt-2 text-sm">
              <div className="flex items-center justify-between"><span className="text-muted-foreground">OTA commission (est.)</span><span className="tabular text-destructive">−{formatINR(otaCommission)}</span></div>
              <div className="mt-0.5 flex items-center justify-between font-semibold"><span>Net revenue</span><span className="tabular">{formatINR(netRevenue)}</span></div>
            </div>
            <p className="text-xs text-muted-foreground">Net = gross − OTA commission. Higher direct share = more margin.</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Revenue by source</CardTitle></CardHeader>
          <CardContent>
            <BreakdownList items={segs.bySource.map((s) => ({ label: sourceLabel(s.source), value: s.revenuePaise }))} emptyLabel="No revenue in range." />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Top corporate clients</CardTitle></CardHeader>
          <CardContent>
            <BreakdownList items={segs.corporates.slice(0, 6).map((c) => ({ label: c.name, value: c.revenuePaise }))} emptyLabel="No corporate bookings in range." />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function SnapshotRow({ icon, label, value, href }: { icon: ReactNode; label: string; value: number; href: string }) {
  return (
    <Link href={href} className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm transition hover:bg-muted/60">
      <span className="inline-flex items-center gap-2 text-muted-foreground [&_svg]:text-primary">{icon} {label}</span>
      <span className="tabular font-semibold">{value}</span>
    </Link>
  );
}

function Spotlight({ tone, title, name, sub, href }: { tone: "good" | "bad"; title: string; name: string; sub: string; href: string }) {
  return (
    <Link href={href} className="u-lift rounded-xl border bg-card p-4 shadow-sm">
      <p className={`text-xs font-semibold uppercase tracking-wide ${tone === "good" ? "text-success" : "text-amber-700 dark:text-amber-400"}`}>{title}</p>
      <p className="mt-1 truncate font-semibold">{name}</p>
      <p className="text-sm text-muted-foreground">{sub}</p>
    </Link>
  );
}
