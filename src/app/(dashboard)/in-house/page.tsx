import type { Metadata } from "next";
import { BedDouble, LogOut, CalendarCheck, AlertTriangle, UserCheck } from "lucide-react";
import { requirePermission } from "@/lib/auth/guard";
import { listReservations, bookingsOverview } from "@/features/reservations/queries";
import { PageHeader } from "@/components/ui/page-header";
import { KpiCard } from "@/components/ui/kpi-card";
import { InHouseTable } from "@/features/reservations/components/in-house-table";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "In-house guests" };

const isToday = (d: Date): boolean => new Date(d).toDateString() === new Date().toDateString();

/**
 * In-House Guests (Reception) — the front desk's primary working list after
 * check-in. A KPI band (who's in, who's leaving, who needs attention) over a live,
 * searchable table ordered by actual check-in time (newest first). Property-scoped.
 */
export default async function InHousePage() {
  const user = await requirePermission("reservation:view");
  const propertyId = user.activePropertyId ?? user.accessiblePropertyIds[0] ?? null;

  const [rows, overview] = propertyId
    ? await Promise.all([
        listReservations(user, { propertyId, status: "IN_HOUSE", limit: 200 }).then((r) => r.reservations),
        bookingsOverview(user, { propertyId, date: new Date() }),
      ])
    : [[], null];

  const leavingToday = rows.filter((r) => isToday(r.checkOutDate)).length;

  return (
    <div className="mx-auto w-full max-w-6xl px-1 py-1">
      <PageHeader
        title="In-house guests"
        description={`${rows.length} guest${rows.length === 1 ? "" : "s"} currently staying${leavingToday ? ` · ${leavingToday} leaving today` : ""}.`}
      />

      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="In-house now" value={rows.length} icon={<UserCheck />} hint="currently staying" />
        <KpiCard
          label="Leaving today"
          value={leavingToday}
          icon={<LogOut />}
          hint={overview ? `${overview.departuresToday} due out` : undefined}
        />
        <KpiCard
          label="Arrivals today"
          value={overview?.arrivalsToday ?? 0}
          icon={<CalendarCheck />}
          hint="due to check in"
        />
        <KpiCard
          label="Needs attention"
          value={overview?.needsAttention ?? 0}
          icon={<AlertTriangle />}
          hint="flagged bookings"
        />
      </div>

      <div className="mt-6">
        {rows.length === 0 ? (
          <div className="rounded-xl border border-dashed bg-muted/30 p-12 text-center">
            <BedDouble className="mx-auto size-6 text-muted-foreground" aria-hidden="true" />
            <p className="mt-3 text-sm font-medium">No guests in-house</p>
            <p className="mt-1 text-sm text-muted-foreground">Checked-in guests will appear here, newest first.</p>
          </div>
        ) : (
          <InHouseTable rows={rows} />
        )}
      </div>
    </div>
  );
}
