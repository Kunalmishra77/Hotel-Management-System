"use client";

/**
 * The room board — 02 T-14 (FR-9, AC-10/AC-11).
 *
 * design.md (phone): a grid of colour-coded chips with status filters; tapping
 * a room opens the action sheet.
 *
 * Client component because the filter and the sheet are interactive. The DATA
 * is computed on the server (`roomBoard`) — including which transitions this
 * caller may drive — so nothing here decides authorization.
 */
import { useMemo, useState } from "react";
import type { RoomStatus } from "@prisma/client";
import { cn } from "@/lib/utils";
import { useRealtime } from "@/hooks/use-realtime";
import type { BoardRoom, RoomBoard as RoomBoardData } from "../queries";
import { RoomChip, STATUS_LABEL, StatusLegend } from "./room-chip";
import { RoomActionSheet } from "./room-action-sheet";

type Filter = RoomStatus | "ALL";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "ALL", label: "All" },
  { key: "VACANT", label: "Vac" },
  { key: "OCCUPIED", label: "Occ" },
  { key: "RESERVED", label: "Resv" },
  { key: "HOUSEKEEPING", label: "HK" },
  { key: "UNDER_MAINTENANCE", label: "Maint" },
];

export function RoomBoard({
  board,
  propertyId,
  canBlock,
  canManage,
}: {
  board: RoomBoardData;
  propertyId: string;
  canBlock: boolean;
  canManage: boolean;
}) {
  const [filter, setFilter] = useState<Filter>("ALL");
  const [selected, setSelected] = useState<BoardRoom | null>(null);

  // AC-11: a status change on another device refreshes this board within the
  // 2s budget. Scoped to this property so an unrelated one does not churn it.
  useRealtime({ types: ["RoomStatusChanged"], propertyId });

  const visible = useMemo(
    () => (filter === "ALL" ? board.rooms : board.rooms.filter((r) => r.status === filter)),
    [board.rooms, filter],
  );

  /** Group by floor so the grid reads like the building. */
  const byFloor = useMemo(() => {
    const groups = new Map<string, BoardRoom[]>();
    for (const room of visible) {
      const key = room.floorName ?? "Unassigned";
      groups.set(key, [...(groups.get(key) ?? []), room]);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));
  }, [visible]);

  return (
    <div className="space-y-4">
      {/* Filters — horizontally scrollable on a phone, all ≥44px. */}
      <div
        role="group"
        aria-label="Filter rooms by status"
        className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1"
      >
        {FILTERS.map(({ key, label }) => {
          const count = key === "ALL" ? board.total : board.counts[key];
          const active = filter === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              aria-pressed={active}
              data-testid={`room-filter-${key}`}
              className={cn(
                "flex min-h-touch shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "hover:bg-accent",
              )}
            >
              {label}
              <span className="tabular-nums opacity-80">{count}</span>
            </button>
          );
        })}
      </div>

      {visible.length === 0 ? (
        <p className="rounded-md border p-6 text-center text-sm text-muted-foreground">
          No rooms {filter === "ALL" ? "yet" : `with status ${STATUS_LABEL[filter].toLowerCase()}`}.
        </p>
      ) : (
        <div className="space-y-4">
          {byFloor.map(([floorName, rooms]) => (
            <section key={floorName}>
              <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {floorName === "Unassigned" ? "No floor" : `Floor ${floorName}`}
              </h2>
              <ul
                className="grid grid-cols-4 gap-2 xs:grid-cols-5 sm:grid-cols-8 lg:grid-cols-12"
                data-testid="room-grid"
              >
                {rooms.map((room) => (
                  <li key={room.id}>
                    <RoomChip room={room} onSelect={setSelected} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      <StatusLegend counts={board.counts} />

      <RoomActionSheet
        room={selected}
        canBlock={canBlock}
        canManage={canManage}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}
