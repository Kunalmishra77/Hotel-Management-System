import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, CalendarPlus, CalendarRange, FileCheck2, LogIn, LogOut, BedDouble, CalendarClock, Search } from "lucide-react";
import { requirePermission } from "@/lib/auth/guard";
import { hasPermission } from "@/lib/permissions";
import { arrivalsDepartures, listReservations, bookingsOverview } from "@/features/reservations/queries";
import { trend } from "@/features/analytics/queries";
import { resolvePortal } from "@/features/platform/portals";
import { SuperAdminBookings } from "@/features/command-center/components/super-admin-bookings";
import { parseBoardView, BOARD_VIEW_LABEL } from "@/features/reservations/domain/board-view";
import { ReservationBoard } from "@/features/reservations/components/reservation-board";
import { ManagerBookings } from "@/features/reservations/components/manager-bookings";
import { KpiCard } from "@/components/ui/kpi-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { BreakdownList } from "@/components/ui/charts/breakdown-list";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Bookings" };

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

// The reservation lifecycle, in order, with a status-chip tone.
const STATUS_STEPS: { key: string; label: string; tone: string }[] = [
  { key: "ENQUIRY", label: "Enquiry / hold", tone: "bg-muted text-muted-foreground" },
  { key: "CONFIRMED", label: "Confirmed", tone: "bg-warning/12 text-warning" },
  { key: "IN_HOUSE", label: "In-house", tone: "bg-success/12 text-success" },
  { key: "CHECKED_OUT", label: "Checked out", tone: "bg-primary/10 text-primary" },
  { key: "CANCELLED", label: "Cancelled", tone: "bg-destructive/10 text-destructive" },
  { key: "NO_SHOW", label: "No-show", tone: "bg-destructive/10 text-destructive" },
];

/**
 * 03 — the bookings command surface for the active property. Front desk opens here
 * and sees the whole day at a glance: today's arrivals/departures/in-house, the
 * lifecycle status mix, OTA bookings needing attention, month volume, and where the
 * business comes from (booking-source mix) — then the live arrivals/in-house/
 * departures board underneath. `reservation:view`; property-scoped.
 */
export default async function BookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; period?: string; from?: string; to?: string }>;
}) {
  const user = await requirePermission("reservation:view");
  const sp = await searchParams;
  const portal = resolvePortal(user.roleAssignments.map((r) => r.role));

  // Super-Admin reads Bookings as a portfolio: totals + per-property outcomes +
  // a recent-bookings feed across EVERY property — not a single-property board,
  // so it runs before the activePropertyId guard.
  if (portal === "SUPER_ADMIN" && hasPermission(user, "report:view-financial")) {
    return <SuperAdminBookings user={user} sp={sp} />;
  }

  const propertyId = user.activePropertyId;
  const view = parseBoardView(sp.view);

  if (!propertyId) {
    return <div className="p-4"><p className="text-sm text-muted-foreground">Select a property to see its bookings.</p></div>;
  }

  // Page-level portal identity: a Manager reads Bookings as performance & insights
  // (volume, funnel, occupancy trend, source mix) — NOT the front desk's
  // operational check-in board. Same route, completely different page.
  if (portal === "MANAGER") {
    const now = new Date();
    const trendFrom = new Date(now.getTime() - 13 * 86_400_000);
    const [mgrOverview, occTrend] = await Promise.all([
      bookingsOverview(user, { propertyId, date: now }),
      hasPermission(user, "report:view-financial")
        ? trend(user, { metric: "occupancy", from: trendFrom, to: now, propertyIds: [propertyId] })
        : Promise.resolve([]),
    ]);
    const dLabel = now.toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short" });
    return (
      <ManagerBookings
        overview={mgrOverview}
        occupancyTrend={occTrend.map((p) => ({ label: p.businessDate, value: p.value }))}
        dateLabel={dLabel}
      />
    );
  }

  const today = new Date();
  const [overview, { arrivals, departures }, inHouse] = await Promise.all([
    bookingsOverview(user, { propertyId, date: today }),
    arrivalsDepartures(user, { propertyId, date: today }),
    listReservations(user, { propertyId, status: "IN_HOUSE", limit: 50 }),
  ]);

  const dateLabel = today.toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short" });

  return (
    <div className="mx-auto w-full max-w-6xl">
      <PageHeader
        title="Bookings"
        description={`Front desk · ${dateLabel}`}
        actions={
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm"><Link href="/bookings/calendar"><CalendarRange className="mr-1.5 size-4" />Calendar</Link></Button>
            <Button asChild variant="outline" size="sm"><Link href="/bookings/form-c"><FileCheck2 className="mr-1.5 size-4" />Form C</Link></Button>
            <Button asChild variant="outline" size="sm"><Link href="/search"><Search className="mr-1.5 size-4" />Search</Link></Button>
            {hasPermission(user, "reservation:create") ? (
              <Button asChild size="sm"><Link href="/bookings/new" data-testid="new-booking-link"><CalendarPlus className="mr-1.5 size-4" />New booking</Link></Button>
            ) : null}
          </div>
        }
      />

      {/* Today at a glance */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6" data-testid="bookings-kpis">
        <KpiCard label="Arrivals today" value={overview.arrivalsToday} icon={<LogIn />} hint="Due to check in" href="/bookings?view=arrivals" />
        <KpiCard label="Departures today" value={overview.departuresToday} icon={<LogOut />} hint="Due to check out" href="/bookings?view=departures" />
        <KpiCard label="In-house" value={overview.inHouse} icon={<BedDouble />} hint="Currently staying" href="/bookings?view=in-house" />
        <KpiCard label="Enquiries / holds" value={overview.statusCounts["ENQUIRY"] ?? 0} icon={<CalendarClock />} hint="Tentative" />
        <KpiCard
          label="Needs attention"
          value={overview.needsAttention}
          icon={<AlertTriangle />}
          trend={overview.needsAttention > 0 ? "down" : undefined}
          delta={overview.needsAttention > 0 ? "OTA oversell" : undefined}
          hint="OTA sync flags"
        />
        <KpiCard label="Booked this month" value={overview.monthBookings} icon={<CalendarPlus />} hint="New reservations" />
      </div>

      {/* Lifecycle status strip */}
      <div className="mt-4 flex flex-wrap gap-2" data-testid="status-strip">
        {STATUS_STEPS.map((s) => (
          <span key={s.key} className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${s.tone}`}>
            {s.label}
            <span className="tabular font-semibold">{overview.statusCounts[s.key] ?? 0}</span>
          </span>
        ))}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        {/* Booking sources — always visible (client requirement) */}
        <Card className="lg:col-span-1">
          <CardHeader className="pb-2"><CardTitle className="text-base">Booking sources</CardTitle></CardHeader>
          <CardContent>
            <BreakdownList
              items={overview.sourceMix.map((s) => ({ label: sourceLabel(s.source), value: s.count }))}
              format="number"
              emptyLabel="No bookings yet."
            />
          </CardContent>
        </Card>

        {/* Live board */}
        <div className="lg:col-span-2">
          {view !== "all" && (
            <div className="mb-3 flex items-center gap-2 text-sm">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 font-medium text-primary">
                Showing: {BOARD_VIEW_LABEL[view]}
              </span>
              <Link href="/bookings" className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
                Clear filter
              </Link>
            </div>
          )}
          <ReservationBoard
            arrivals={arrivals}
            inHouse={inHouse.reservations}
            departures={departures}
            canCheckIn={hasPermission(user, "checkin:perform")}
            canCheckOut={hasPermission(user, "checkout:perform")}
            view={view}
          />
        </div>
      </div>
    </div>
  );
}
