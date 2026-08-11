import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight, LayoutGrid } from "lucide-react";
import { requirePermission } from "@/lib/auth/guard";
import { reservationCalendar } from "@/features/reservations/queries";
import { ReservationCalendar } from "@/features/reservations/components/reservation-calendar";
import { roomBoard } from "@/features/rooms/queries";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Reservation calendar" };

const WINDOW_DAYS = 14;
const DAY_MS = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const utcMidnight = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/**
 * 03 — the reservation calendar (tape chart) for the active property: rooms ×
 * a 14-day window, each allocation a status-coded bar that opens its booking.
 * `reservation:view`; property-scoped. Window is driven by ?from (property-local).
 */
export default async function BookingsCalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const user = await requirePermission("reservation:view");
  const propertyId = user.activePropertyId;
  if (!propertyId) {
    return <div className="p-4"><p className="text-sm text-muted-foreground">Select a property to see the calendar.</p></div>;
  }

  const today = utcMidnight(new Date());
  const { from: fromParam } = await searchParams;
  const parsed = fromParam ? new Date(`${fromParam}T00:00:00.000Z`) : today;
  const from = Number.isNaN(parsed.getTime()) ? today : utcMidnight(parsed);
  const to = new Date(from.getTime() + WINDOW_DAYS * DAY_MS);

  const days = Array.from({ length: WINDOW_DAYS }, (_, i) => new Date(from.getTime() + i * DAY_MS));
  const prev = iso(new Date(from.getTime() - 7 * DAY_MS));
  const next = iso(new Date(from.getTime() + 7 * DAY_MS));

  const [board, allocations] = await Promise.all([
    roomBoard(user, { propertyId }),
    reservationCalendar(user, { propertyId, from, to }),
  ]);
  const rooms = board.rooms.map((r) => ({ id: r.id, number: r.number, categoryName: r.categoryName }));

  const rangeLabel = `${from.toLocaleDateString("en-IN", { day: "2-digit", month: "short", timeZone: "UTC" })} – ${new Date(to.getTime() - DAY_MS).toLocaleDateString("en-IN", { day: "2-digit", month: "short", timeZone: "UTC" })}`;

  return (
    <div className="mx-auto w-full max-w-6xl">
      <PageHeader
        title="Reservation calendar"
        description={rangeLabel}
        actions={
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm"><Link href="/bookings"><LayoutGrid className="mr-1.5 size-4" />Board</Link></Button>
            <Button asChild variant="outline" size="icon" aria-label="Previous week"><Link href={`/bookings/calendar?from=${prev}`}><ChevronLeft className="size-4" /></Link></Button>
            <Button asChild variant="outline" size="sm"><Link href="/bookings/calendar">Today</Link></Button>
            <Button asChild variant="outline" size="icon" aria-label="Next week"><Link href={`/bookings/calendar?from=${next}`}><ChevronRight className="size-4" /></Link></Button>
          </div>
        }
      />

      {/* Legend */}
      <div className="mb-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <LegendSwatch className="bg-warning/25" label="Confirmed" />
        <LegendSwatch className="bg-success/25" label="In-house" />
        <LegendSwatch className="bg-primary/10" label="Checked out" />
        <LegendSwatch className="bg-muted" label="Enquiry / hold" />
      </div>

      {rooms.length === 0 ? (
        <p className="rounded-md border bg-muted/40 p-6 text-center text-sm text-muted-foreground">No rooms configured for this property.</p>
      ) : (
        <ReservationCalendar rooms={rooms} allocations={allocations} days={days} todayTime={today.getTime()} />
      )}
    </div>
  );
}

function LegendSwatch({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`inline-block size-3 rounded-sm border ${className}`} />
      {label}
    </span>
  );
}
