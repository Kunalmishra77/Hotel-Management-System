import type { Metadata } from "next";
import Link from "next/link";
import { Layers } from "lucide-react";
import { requirePermission } from "@/lib/auth/guard";
import { can } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { roomBoard, roomsOverviewAll } from "@/features/rooms/queries";
import { RoomBoard } from "@/features/rooms/components/room-board";
import { RoomsOverviewAllView } from "@/features/rooms/components/rooms-overview-all";
import { PropertyChooserCards } from "@/features/platform/components/property-chooser-cards";
import { BackToAllProperties } from "@/features/platform/components/back-to-all-properties";
import { NoProperty } from "@/features/platform/components/no-property";
import { roomAvailabilityCalendar } from "@/features/reservations/queries";
import { GRID_MAX_NIGHTS } from "@/features/reservations/availability-grid";
import { AvailabilityGridTable } from "@/features/reservations/components/availability-grid-table";

export const metadata: Metadata = { title: "Rooms" };

/**
 * 02 T-14 room board (FR-9, AC-10/11) with the client's property-first flow (#9):
 * "All hotels" → the 4 properties as cards (each with live room stats) → click one
 * → that property's room board. Switching from the top-bar selector works too.
 */
export default async function RoomsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; from?: string; to?: string }>;
}) {
  const user = await requirePermission("room:view-status");
  const propertyId = user.activePropertyId;

  // Default (all hotels): a cross-property, room-type-grouped overview (counts are
  // derived from who's actually in-house, so they're right even if a room's stored
  // status is stale), then the properties as cards to drill into.
  if (!propertyId) {
    const overview = await roomsOverviewAll(user);
    if (overview.byProperty.length === 0) {
      return <NoProperty what="Rooms" canCreate={can(user, "property:manage", null)} />;
    }
    return (
      <div className="mx-auto w-full max-w-[1600px] space-y-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Rooms</h1>
          <p className="text-sm text-muted-foreground">Live room availability across all properties, by room type. Choose a hotel below to manage its rooms.</p>
        </div>
        <RoomsOverviewAllView data={overview} />
        <div>
          <h2 className="mb-3 text-sm font-semibold text-muted-foreground">Open a property</h2>
          <PropertyChooserCards
            what="rooms"
            properties={overview.byProperty.map((p) => ({
              id: p.id,
              name: p.name,
              city: p.city,
              state: p.state,
              total: p.total,
              occupied: p.occupied,
              available: p.available,
              maintenance: p.maintenance,
              occupancyPct: Math.round(p.occupancyBps / 100),
            }))}
          />
        </div>
      </div>
    );
  }

  // Focused on one property: today's board (derived from bookings), or the
  // room × night availability for a date range.
  const sp = await searchParams;
  const board = await roomBoard(user, { propertyId });
  const view = sp.view === "availability" ? "availability" : "board";
  // Live occupancy = occupied ÷ sellable (active minus out-of-order). Headline stat.
  const sellable = board.total - board.counts.UNDER_MAINTENANCE;
  const liveOccPct = sellable > 0 ? Math.round((board.counts.OCCUPIED / sellable) * 100) : 0;
  const stats: { label: string; value: number | string }[] = [
    { label: "Rooms", value: board.total },
    { label: "Occupied", value: board.counts.OCCUPIED },
    { label: "Free now", value: board.counts.VACANT },
    { label: "Arriving today", value: board.arrivingToday },
    { label: "Leaving today", value: board.departingToday },
    { label: "Cleaning", value: board.counts.HOUSEKEEPING },
    { label: "Out of order", value: board.counts.UNDER_MAINTENANCE },
    { label: "Occupancy now", value: `${liveOccPct}%` },
  ];

  const from = isYmd(sp.from) ? sp.from : board.today;
  const toDefault = addDays(from, 14);
  const to = isYmd(sp.to) && sp.to > from ? (sp.to > addDays(from, GRID_MAX_NIGHTS) ? addDays(from, GRID_MAX_NIGHTS) : sp.to) : toDefault;
  const grid = view === "availability" ? await roomAvailabilityCalendar(user, { propertyId, from, to }) : null;
  const tab = (key: string, label: string) => (
    <Link
      href={key === "board" ? "/rooms" : `/rooms?view=availability&from=${from}&to=${to}`}
      aria-current={view === key ? "page" : undefined}
      className={`inline-flex min-h-touch items-center rounded-md px-3 text-sm font-medium ${view === key ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}
    >
      {label}
    </Link>
  );

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-4">
      <BackToAllProperties />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Rooms</h1>
          <p className="text-sm text-muted-foreground">Live from bookings — who is in each room, until when, and when it is free next.</p>
        </div>
        <div className="flex items-center gap-2">
          {can(user, "reservation:create", propertyId) && (
            <Button asChild size="sm"><Link href="/bookings/new">New booking</Link></Button>
          )}
          {can(user, "room:manage", propertyId) && (
            <Button asChild variant="outline" size="sm">
              <Link href="/rooms/categories">
                <Layers className="size-4" />
                Categories
              </Link>
            </Button>
          )}
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-2 xs:grid-cols-4 lg:grid-cols-8" data-testid="room-stats">
        {stats.map((s) => (
          <div key={s.label} className="rounded-md border px-3 py-2">
            <dt className="text-xs text-muted-foreground">{s.label}</dt>
            <dd className="text-lg font-semibold tabular-nums">{s.value}</dd>
          </div>
        ))}
      </dl>

      <nav className="flex gap-1 rounded-md border p-1" aria-label="Rooms view">
        {tab("board", "Today")}
        {tab("availability", "Availability by date")}
      </nav>

      {grid ? (
        <section className="space-y-3">
          <form className="flex flex-wrap items-end gap-2" action="/rooms">
            <input type="hidden" name="view" value="availability" />
            <label className="space-y-1 text-sm">
              <span className="block text-muted-foreground">From</span>
              <input type="date" name="from" defaultValue={from} className="h-10 rounded-md border border-input bg-background px-3" />
            </label>
            <label className="space-y-1 text-sm">
              <span className="block text-muted-foreground">To (check-out)</span>
              <input type="date" name="to" defaultValue={to} className="h-10 rounded-md border border-input bg-background px-3" />
            </label>
            <Button type="submit" variant="outline">Show</Button>
          </form>
          <p className="text-xs text-muted-foreground">
            Each column is a night. <b>Free</b> = can be sold that night; coloured = booked (initials of the guest, tap to open the booking); OOO = out of order. Up to {GRID_MAX_NIGHTS} nights.
          </p>
          <AvailabilityGridTable grid={grid} linkBookings today={board.today} showFreeCount />
        </section>
      ) : (
        <RoomBoard
          board={board}
          propertyId={propertyId}
          canBlock={can(user, "maintenance:manage", propertyId)}
          canManage={can(user, "room:manage", propertyId)}
        />
      )}
    </div>
  );
}

const isYmd = (v: string | undefined): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
const addDays = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
