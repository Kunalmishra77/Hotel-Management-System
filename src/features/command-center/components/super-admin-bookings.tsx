/**
 * Super-Admin Bookings — a portfolio-wide view of bookings across every property
 * (not a single-property front-desk board). Totals + per-property outcomes + a
 * recent-bookings feed, over a selectable period. Read-only; reuses the canonical
 * booking-count queries. `report:view-financial`.
 */
import Link from "next/link";
import { CalendarCheck, XCircle, UserX, IndianRupee, UserCheck } from "lucide-react";
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
  sp: { period?: string; from?: string; to?: string; status?: string };
}) {
  const today = new Date();
  const period = parsePeriod(sp.period);
  const win = periodRange(period, today, { from: sp.from, to: sp.to });
  const propertyIds = [...user.accessiblePropertyIds];

  // Clickable-card filter: a valid status narrows the list below (else recent 30).
  const VALID_STATUS = ["CONFIRMED", "IN_HOUSE", "CHECKED_OUT", "CANCELLED", "NO_SHOW"] as const;
  const statusFilter = VALID_STATUS.includes(sp.status as never) ? sp.status : undefined;

  const [counts, perProperty, recent, portfolio] = await Promise.all([
    portfolioBookingCounts(user, { propertyIds, from: win.from, to: win.to }),
    perPropertyBookingCounts(user, { propertyIds, from: win.from, to: win.to }),
    recentPortfolioBookings(user, { propertyIds, limit: statusFilter ? 200 : 30, status: statusFilter }),
    getPortfolio(user, win.from, win.to),
  ]);
  // Preserve the period in card links so filtering doesn't reset the date window.
  const q = (status?: string) => {
    const parts = [sp.period ? `period=${sp.period}` : "", sp.from ? `from=${sp.from}` : "", sp.to ? `to=${sp.to}` : "", status ? `status=${status}` : ""].filter(Boolean);
    return `/bookings${parts.length ? `?${parts.join("&")}` : ""}`;
  };
  const STATUS_LABEL: Record<string, string> = { CONFIRMED: "Confirmed", IN_HOUSE: "In-house", CHECKED_OUT: "Checked out", CANCELLED: "Cancelled", NO_SHOW: "No-show" };

  return (
    <div className="mx-auto w-full max-w-6xl">
      <PageHeader
        title="Bookings"
        description={`Every property · ${win.label}`}
        actions={
          <span className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:inline-flex">
            <UserCheck className="size-4" /> Pick a property to open its front desk
          </span>
        }
      />
      <p className="mt-1 text-xs text-muted-foreground">This is the all-hotels portfolio view. To check guests in / out and manage today&apos;s arrivals, <span className="font-medium">pick a property from the selector at the top</span> — the front-desk board opens for it.</p>

      <div className="mt-1">
        <PeriodFilter period={period} from={iso(win.from)} to={iso(win.to)} />
      </div>

      <div className="mb-4 mt-4 grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-5" data-testid="portfolio-booking-kpis">
        <KpiCard label="Bookings" value={counts.bookings} icon={<CalendarCheck />} hint="Confirmed / in-house / stayed" href={q()} tooltip="All realised bookings in the period — click to list them." />
        <KpiCard label="In-house" value={counts.inHouse} icon={<CalendarCheck />} hint="staying now" href={q("IN_HOUSE")} tooltip="Guests currently checked in — click to list." />
        <KpiCard label="Cancellations" value={counts.cancelled} icon={<XCircle />} hint="In this period" href={q("CANCELLED")} tooltip="Cancelled bookings — click to list." className={counts.cancelled > 0 ? "border-destructive/30" : undefined} />
        <KpiCard label="No-shows" value={counts.noShow} icon={<UserX />} hint="In this period" href={q("NO_SHOW")} tooltip="Confirmed guests who never arrived — click to list." />
        <KpiCard label="Revenue" value={formatINR(portfolio.totals.revenuePaise)} icon={<IndianRupee />} hint="Net of discounts, ex-tax" href="/reports" tooltip="Room + service revenue, net of discounts, excluding GST." />
      </div>

      <Card className="mb-4">
        <CardHeader className="pb-2"><CardTitle className="text-base">By property</CardTitle></CardHeader>
        <CardContent><PerPropertyBookingsTable rows={perProperty} /></CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between gap-2 pb-2">
          <CardTitle className="text-base">
            {statusFilter ? `${STATUS_LABEL[statusFilter]} bookings` : "Recent bookings"}
            <span className="ml-2 text-sm font-normal text-muted-foreground">({recent.length})</span>
          </CardTitle>
          {statusFilter ? (
            <Link href={q()} className="text-xs font-medium text-primary underline-offset-4 hover:underline" data-testid="clear-booking-filter">Clear filter ✕</Link>
          ) : null}
        </CardHeader>
        <CardContent><RecentBookingsTable rows={recent} /></CardContent>
      </Card>
    </div>
  );
}
