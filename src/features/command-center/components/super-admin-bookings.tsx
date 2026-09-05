/**
 * Super-Admin Bookings — a portfolio-wide view of bookings across every property
 * (not a single-property front-desk board). Totals + per-property outcomes + a
 * recent-bookings feed, over a selectable period. Read-only; reuses the canonical
 * booking-count queries. `report:view-financial`.
 */
import { CalendarCheck, XCircle, UserX, Percent, IndianRupee } from "lucide-react";
import type { SessionClaims } from "@/lib/auth/claims";
import { parsePeriod, periodRange } from "@/features/command-center/domain/period";
import {
  portfolioBookingCounts,
  perPropertyBookingCounts,
  recentPortfolioBookings,
  getPortfolio,
} from "@/features/command-center/queries";
import { PeriodFilter } from "@/features/command-center/components/period-filter";
import {
  PerPropertyBookingsTable,
  RecentBookingsTable,
} from "@/features/command-center/components/portfolio-bookings-tables";
import { KpiCard } from "@/components/ui/kpi-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { formatINR } from "@/lib/utils";

const iso = (d: Date) => d.toISOString().slice(0, 10);

export async function SuperAdminBookings({
  user,
  sp,
}: {
  user: SessionClaims;
  sp: { period?: string; from?: string; to?: string };
}) {
  const today = new Date();
  const period = parsePeriod(sp.period);
  const win = periodRange(period, today, { from: sp.from, to: sp.to });
  const propertyIds = [...user.accessiblePropertyIds];

  const [counts, perProperty, recent, portfolio] = await Promise.all([
    portfolioBookingCounts(user, { propertyIds, from: win.from, to: win.to }),
    perPropertyBookingCounts(user, { propertyIds, from: win.from, to: win.to }),
    recentPortfolioBookings(user, { propertyIds, limit: 30 }),
    getPortfolio(user, win.from, win.to),
  ]);

  return (
    <div className="mx-auto w-full max-w-6xl">
      <PageHeader title="Bookings" description={`Every property · ${win.label}`} />

      <div className="mt-1">
        <PeriodFilter period={period} from={iso(win.from)} to={iso(win.to)} />
      </div>

      <div className="mb-4 mt-4 grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-5" data-testid="portfolio-booking-kpis">
        <KpiCard label="Bookings" value={counts.bookings} icon={<CalendarCheck />} hint="Confirmed / in-house / stayed" />
        <KpiCard label="Cancellations" value={counts.cancelled} icon={<XCircle />} hint="In this period" />
        <KpiCard label="No-shows" value={counts.noShow} icon={<UserX />} hint="In this period" />
        <KpiCard label="Cancel rate" value={`${counts.cancelRatePct}%`} icon={<Percent />} hint="Cancelled + no-show" trend={counts.cancelRatePct > 20 ? "down" : undefined} />
        <KpiCard label="Revenue" value={formatINR(portfolio.totals.revenuePaise)} icon={<IndianRupee />} hint="Net of discounts, ex-tax" />
      </div>

      <Card className="mb-4">
        <CardHeader className="pb-2"><CardTitle className="text-base">By property</CardTitle></CardHeader>
        <CardContent><PerPropertyBookingsTable rows={perProperty} /></CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Recent bookings</CardTitle></CardHeader>
        <CardContent><RecentBookingsTable rows={recent} /></CardContent>
      </Card>
    </div>
  );
}
