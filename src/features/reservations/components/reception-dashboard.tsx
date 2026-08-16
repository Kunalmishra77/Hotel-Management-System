import Link from "next/link";
import {
  CalendarPlus, UserPlus, Search, ReceiptText, BedDouble, CalendarCheck, LogOut,
  UserCheck, Gauge, DoorOpen, AlertTriangle, ArrowRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { KpiCard } from "@/components/ui/kpi-card";
import { ArrivalsDeparturesCard } from "./arrivals-departures-card";
import type { ReservationListItem, BookingsOverview } from "../queries";
import type { LiveTiles } from "@/features/analytics/queries";

const ROOM_STATES: { key: keyof LiveTiles["rooms"]; label: string; varName: string }[] = [
  { key: "vacant", label: "Vacant", varName: "--status-vacant" },
  { key: "occupied", label: "Occupied", varName: "--status-occupied" },
  { key: "reserved", label: "Reserved", varName: "--status-reserved" },
  { key: "housekeeping", label: "Housekeeping", varName: "--status-housekeeping" },
  { key: "maintenance", label: "Maintenance", varName: "--status-maintenance" },
];

/**
 * Reception front-desk command centre — the operational home for the desk: fast
 * actions, a live operational KPI band, today's arrivals/departures to work, and a
 * room-status snapshot. Distinct from the Manager dashboard (which is monitoring +
 * analytics). Read-only aggregates; each tile is a door to the working screen.
 */
export function ReceptionDashboard({
  name,
  propertyName,
  tiles,
  overview,
  arrivals,
  departures,
  can,
}: {
  name: string;
  propertyName: string | null;
  tiles: LiveTiles | null;
  overview: BookingsOverview | null;
  arrivals: ReservationListItem[];
  departures: ReservationListItem[];
  can: { create: boolean; guestCreate: boolean; folioView: boolean; roomView: boolean };
}) {
  const today = new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "short" });
  const occupancyPct = tiles ? Math.round(tiles.occupancyBps / 100) : null;
  const sellable = tiles ? tiles.rooms.vacant + tiles.rooms.occupied + tiles.rooms.reserved + tiles.rooms.housekeeping : 0;

  const actions = [
    { show: can.create, label: "New booking", href: "/bookings/new", icon: <CalendarPlus />, primary: true },
    { show: can.guestCreate, label: "New guest", href: "/guests/new", icon: <UserPlus /> },
    { show: true, label: "Find guest", href: "/search", icon: <Search /> },
    { show: can.roomView, label: "Room board", href: "/rooms", icon: <DoorOpen /> },
    { show: can.folioView, label: "Billing", href: "/billing", icon: <ReceiptText /> },
  ].filter((a) => a.show);

  return (
    <div className="space-y-6">
      <PageHeader title={`Front desk — welcome, ${name}`} description={`${today}${propertyName ? ` · ${propertyName}` : ""}`} />

      {/* Operational quick actions */}
      <div className="flex flex-wrap gap-2">
        {actions.map((a) => (
          <Button key={a.label} asChild size="lg" variant={a.primary ? "default" : "outline"}>
            <Link href={a.href}>
              {a.icon}
              <span className="ml-1.5">{a.label}</span>
            </Link>
          </Button>
        ))}
      </div>

      {/* Live operational KPI band */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <KpiCard label="Occupancy" value={occupancyPct === null ? "—" : `${occupancyPct}%`} icon={<Gauge />} hint={tiles ? `${tiles.rooms.occupied}/${sellable} rooms` : undefined} href="/rooms" />
        <KpiCard label="Arrivals today" value={overview?.arrivalsToday ?? 0} icon={<CalendarCheck />} hint="due to check in" href="/bookings" />
        <KpiCard label="Departures today" value={overview?.departuresToday ?? 0} icon={<LogOut />} hint="due to check out" href="/in-house" />
        <KpiCard label="In-house" value={overview?.inHouse ?? 0} icon={<UserCheck />} hint="staying now" href="/in-house" />
        <KpiCard label="Vacant rooms" value={tiles?.rooms.vacant ?? 0} icon={<BedDouble />} hint="ready to sell" href="/rooms" />
        <KpiCard
          label="Needs attention"
          value={overview?.needsAttention ?? 0}
          icon={<AlertTriangle />}
          hint="flagged"
          href="/bookings"
          className={overview && overview.needsAttention > 0 ? "border-destructive/40" : undefined}
        />
      </div>

      {/* Today's working board */}
      <div className="grid gap-4 lg:grid-cols-2">
        <ArrivalsDeparturesCard title="Arrivals today" icon={<CalendarCheck />} emptyLabel="No arrivals due today." items={arrivals} />
        <ArrivalsDeparturesCard title="Departures today" icon={<LogOut />} emptyLabel="No departures due today." items={departures} />
      </div>

      {/* Room-status snapshot */}
      {tiles ? (
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="flex items-center gap-2 text-base [&_svg]:size-4 [&_svg]:text-primary">
              <DoorOpen /> Room status
            </CardTitle>
            <Link href="/rooms" className="inline-flex items-center gap-1 text-sm font-medium text-primary underline-offset-4 hover:underline">
              Room board <ArrowRight className="size-3.5" aria-hidden="true" />
            </Link>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {ROOM_STATES.map((s) => (
                <Link
                  key={s.key}
                  href="/rooms"
                  className="u-lift flex items-center gap-3 rounded-lg border bg-card p-3"
                >
                  <span className="size-2.5 shrink-0 rounded-full" style={{ background: `hsl(var(${s.varName}))` }} aria-hidden="true" />
                  <div className="min-w-0">
                    <div className="font-display text-xl font-bold tabular leading-none">{tiles.rooms[s.key]}</div>
                    <div className="mt-0.5 truncate text-xs text-muted-foreground">{s.label}</div>
                  </div>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
