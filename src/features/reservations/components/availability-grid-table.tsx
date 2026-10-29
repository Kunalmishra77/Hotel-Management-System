"use client";

/**
 * Room × night grid — free / booked / out of order per night. Used two ways:
 *  - booking form split stay: tap a free night to put the guest in that room;
 *  - Rooms calendar: read-only, booked nights link to the booking.
 * Colour is never the only signal: every cell carries a text label / title.
 */
import Link from "next/link";
import { cn } from "@/lib/utils";
import type { AvailabilityGrid, GridCell } from "../availability-grid";
import type { NightPicks } from "../domain/split-stay";

const head = (night: string) => {
  const d = new Date(`${night}T00:00:00Z`);
  return {
    dow: d.toLocaleDateString("en-IN", { weekday: "short", timeZone: "UTC" }),
    dm: d.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }),
  };
};
const initials = (name: string | null, code: string) =>
  name ? name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("") : code.slice(-3);

export function AvailabilityGridTable({
  grid,
  picks,
  onPick,
  linkBookings = false,
  today,
  showFreeCount = false,
}: {
  grid: AvailabilityGrid;
  picks?: NightPicks;
  onPick?: (night: string, roomId: string) => void;
  linkBookings?: boolean;
  today?: string;
  showFreeCount?: boolean;
}) {
  return (
    <div className="overflow-x-auto rounded-md border" data-testid="availability-grid">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="bg-muted/50">
            <th className="sticky left-0 z-10 min-w-24 bg-muted px-2 py-1.5 text-left font-medium">Room</th>
            {grid.nights.map((n) => {
              const h = head(n);
              return (
                <th key={n} className={cn("min-w-12 px-1 py-1.5 text-center font-medium", n === today && "text-primary")}>
                  <div className="text-[10px] text-muted-foreground">{h.dow}</div>
                  <div className="whitespace-nowrap">{h.dm}</div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {grid.rooms.map((room) => (
            <tr key={room.id} className="border-t">
              <th scope="row" className="sticky left-0 z-10 bg-background px-2 py-1 text-left font-normal">
                <div className="font-semibold tabular-nums">{room.number}</div>
                <div className="max-w-28 truncate text-[10px] text-muted-foreground">{room.categoryName}</div>
              </th>
              {room.cells.map((cell, i) => (
                <td key={grid.nights[i]} className="p-0.5">
                  <Cell
                    cell={cell}
                    night={grid.nights[i]!}
                    roomNumber={room.number}
                    picked={picks?.[grid.nights[i]!] === room.id}
                    onPick={onPick ? () => onPick(grid.nights[i]!, room.id) : undefined}
                    linkBookings={linkBookings}
                    first={i === 0}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {showFreeCount && (
          <tfoot>
            <tr className="border-t bg-muted/50 font-medium">
              <th scope="row" className="sticky left-0 z-10 bg-muted px-2 py-1.5 text-left">Free rooms</th>
              {grid.nights.map((n, i) => (
                <td key={n} className="px-1 py-1.5 text-center tabular-nums" data-testid={`free-count-${n}`}>
                  {grid.rooms.filter((r) => r.cells[i]!.state === "free").length}/{grid.rooms.length}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

function Cell({
  cell,
  night,
  roomNumber,
  picked,
  onPick,
  linkBookings,
  first,
}: {
  first: boolean;
  cell: GridCell;
  night: string;
  roomNumber: string;
  picked: boolean;
  onPick?: () => void;
  linkBookings: boolean;
}) {
  const base = "flex h-9 w-full min-w-11 items-center justify-center rounded text-[11px] font-medium";
  if (cell.state === "free") {
    const label = picked ? `Room ${roomNumber} chosen for ${night}` : `Room ${roomNumber} free on ${night}`;
    if (!onPick) return <span className={cn(base, "bg-status-vacant/10 text-status-vacant")} title={label}>Free</span>;
    return (
      <button
        type="button"
        onClick={onPick}
        aria-pressed={picked}
        aria-label={label}
        data-testid={`grid-${roomNumber}-${night}`}
        className={cn(
          base,
          "border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          picked ? "border-primary bg-primary text-primary-foreground" : "border-status-vacant/40 bg-status-vacant/10 text-status-vacant hover:bg-status-vacant/25",
        )}
      >
        {picked ? "✓" : "Free"}
      </button>
    );
  }
  if (cell.state === "blocked") {
    return <span className={cn(base, "bg-status-maintenance/15 text-status-maintenance")} title={cell.reason}>OOO</span>;
  }
  const occupied = cell.status === "IN_HOUSE" || cell.status === "CHECKED_OUT";
  const title = `${cell.guestName ?? "Booked"} · ${cell.code}`;
  const inner = (
    <span
      className={cn(base, occupied ? "bg-status-occupied/15 text-status-occupied" : "bg-status-reserved/15 text-status-reserved")}
      title={title}
    >
      {cell.startsHere || first ? initials(cell.guestName, cell.code) : "·"}
    </span>
  );
  return linkBookings ? <Link href={`/bookings/${cell.reservationId}`} aria-label={title}>{inner}</Link> : inner;
}
