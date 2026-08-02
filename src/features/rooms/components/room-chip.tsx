/**
 * A single room on the board — 02 T-14 (AC-10).
 *
 * design.md draws these as coloured chips: 101🟢 102🔴 103🟡 …
 * Colours come from the ONE status map in ui-foundation.md — vacant green,
 * occupied red, reserved amber, housekeeping orange, maintenance violet — never
 * an ad-hoc colour.
 *
 * Colour is never the only signal (WCAG 1.4.1): each chip carries the status in
 * its accessible name, and a blocked room shows a visible marker.
 */
import type { RoomStatus } from "@prisma/client";
import { cn } from "@/lib/utils";
import type { BoardRoom } from "../queries";

export const STATUS_LABEL: Record<RoomStatus, string> = {
  VACANT: "Vacant",
  OCCUPIED: "Occupied",
  RESERVED: "Reserved",
  HOUSEKEEPING: "Housekeeping",
  UNDER_MAINTENANCE: "Under maintenance",
};

const STATUS_CLASS: Record<RoomStatus, string> = {
  VACANT: "bg-status-vacant/15 text-status-vacant border-status-vacant/40",
  OCCUPIED: "bg-status-occupied/15 text-status-occupied border-status-occupied/40",
  RESERVED: "bg-status-reserved/15 text-status-reserved border-status-reserved/40",
  HOUSEKEEPING: "bg-status-housekeeping/15 text-status-housekeeping border-status-housekeeping/40",
  UNDER_MAINTENANCE:
    "bg-status-maintenance/15 text-status-maintenance border-status-maintenance/40",
};

export function RoomChip({
  room,
  onSelect,
}: {
  room: BoardRoom;
  onSelect: (room: BoardRoom) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(room)}
      data-testid={`room-chip-${room.number}`}
      data-status={room.status}
      aria-label={`Room ${room.number}, ${room.categoryName}, ${STATUS_LABEL[room.status]}${
        room.blockedToday ? ", blocked" : ""
      }`}
      className={cn(
        "relative flex min-h-touch min-w-touch flex-col items-center justify-center gap-0.5",
        "rounded-md border px-2 py-1.5 text-sm font-semibold transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        STATUS_CLASS[room.status],
      )}
    >
      <span className="tabular-nums">{room.number}</span>
      {/* Redundant text label — never colour alone (WCAG 1.4.1). */}
      <span className="text-[10px] font-normal opacity-80">
        {STATUS_LABEL[room.status].slice(0, 4)}
      </span>
      {room.blockedToday && (
        <span
          aria-hidden="true"
          title="Blocked"
          className="absolute right-1 top-1 size-1.5 rounded-full bg-status-maintenance"
        />
      )}
    </button>
  );
}

/** The legend beneath the grid — the same single colour map. */
export function StatusLegend({ counts }: { counts: Record<RoomStatus, number> }) {
  const order: RoomStatus[] = [
    "VACANT",
    "OCCUPIED",
    "RESERVED",
    "HOUSEKEEPING",
    "UNDER_MAINTENANCE",
  ];

  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {order.map((status) => (
        <li key={status} className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className={cn("size-2 rounded-full", STATUS_CLASS[status].split(" ")[0])}
          />
          {STATUS_LABEL[status]}
          <span className="font-medium text-foreground tabular-nums">{counts[status]}</span>
        </li>
      ))}
    </ul>
  );
}
