/**
 * Super-Admin Bookings — a portfolio-wide view of bookings across every property
 * (not a single-property front-desk board). Totals + per-property outcomes + a
 * recent-bookings feed, over a selectable period. Read-only; reuses the canonical
 * booking-count queries. `report:view-financial`.
 */
import { CalendarCheck, XCircle, UserX, IndianRupee, UserCheck } from "lucide-react";
import type { SessionClaims } from "@/lib/auth/claims";
import { parsePeriod, periodRange } from "@/features/command-center/domain/period";
import {
  portfolioBookingCounts,
  perPropertyBookingCounts,
  getPortfolio,
} from "@/features/command-center/queries";
import { arrivalsDeparturesPortfolio, findBookings } from "@/features/reservations/queries";
import { parseFinderParams } from "@/features/reservations/domain/finder";
import { BookingsFinder } from "@/features/reservations/components/bookings-finder";
import { listProperties } from "@/features/properties/queries";
import { TodayMovements } from "@/features/command-center/components/operations-today";
import { PeriodFilter } from "@/features/command-center/components/period-filter";
import { PerPropertyBookingsTable } from "@/features/command-center/components/portfolio-bookings-tables";
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
  sp: Record<string, string | undefined>;
}) {
  const today = new Date();
  const todayStr = today.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const period = parsePeriod(sp.period);
  const win = periodRange(period, today, { from: sp.from, to: sp.to });
  const propertyIds = [...user.accessiblePropertyIds];
  // The bookings finder at the bottom: every property by default, filterable.
  const finderParams = parseFinderParams(sp, { prop: "all" });

  const [counts, perProperty, finder, portfolio, movements, props] = await Promise.all([
    portfolioBookingCounts(user, { propertyIds, from: win.from, to: win.to }),
    perPropertyBookingCounts(user, { propertyIds, from: win.from, to: win.to }),
    findBookings(user, finderParams),
    getPortfolio(user, win.from, win.to),
    arrivalsDeparturesPortfolio(user, propertyIds, today),
    listProperties(user),
  ]);
  const hotels = props.filter((p) => !p.isCostCenter).map((p) => ({ id: p.id, name: p.name }));
  // Preserve the period in card links so filtering doesn't reset the date window;
  // cards land on the bookings list.
  const keep = { period: sp.period, from: sp.from, to: sp.to };
  const q = (status?: string) => {
    const parts = [sp.period ? `period=${sp.period}` : "", sp.from ? `from=${sp.from}` : "", sp.to ? `to=${sp.to}` : "", status ? `status=${status}` : ""].filter(Boolean);
    return `/bookings${parts.length ? `?${parts.join("&")}` : ""}#bookings-list`;
  };

  return (
    <div className="mx-auto w-full max-w-[1600px]">
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

      {/* Today's movements across every property — the central team's "who's coming/going" */}
      <div className="mb-4">
        <TodayMovements arrivals={movements.arrivals} departures={movements.departures} />
      </div>

      <Card className="mb-4">
        <CardHeader className="pb-2"><CardTitle className="text-base">By property</CardTitle></CardHeader>
        <CardContent><PerPropertyBookingsTable rows={perProperty} /></CardContent>
      </Card>

      <BookingsFinder result={finder} params={finderParams} properties={hotels} today={todayStr} keep={keep} title="Bookings" />
    </div>
  );
}
