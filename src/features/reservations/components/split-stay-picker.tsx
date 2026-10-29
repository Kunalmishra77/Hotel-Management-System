"use client";

/**
 * Partly-free rooms + split stay for the booking form (client: "a room free for
 * part of the dates stays empty because the form hides it").
 *
 * Lists every room that is free for SOME of the nights with its free windows, and
 * lets reception put one guest in different rooms on different nights — tap a
 * free night per room, or "Suggest" for the fewest room changes. The plan is
 * submitted as allocation segments; the server re-checks every segment.
 */
import { Button } from "@/components/ui/button";
import type { AvailabilityGrid, GridRoom } from "../availability-grid";
import { segmentsFromPicks, suggestSplit, type NightPicks } from "../domain/split-stay";
import { AvailabilityGridTable } from "./availability-grid-table";

const dm = (night: string) =>
  new Date(`${night}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
const nextDay = (night: string) => new Date(Date.parse(`${night}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/** "24 Oct → 26 Oct, 27 Oct → 28 Oct" — the free windows of one room (check-out style ends). */
export function freeWindows(room: GridRoom, nights: string[]): string {
  const out: string[] = [];
  let start: string | null = null;
  room.cells.forEach((c, i) => {
    const n = nights[i]!;
    if (c.state === "free" && start === null) start = n;
    const endsHere = c.state === "free" && (i === nights.length - 1 || room.cells[i + 1]!.state !== "free");
    if (endsHere && start) {
      out.push(`${dm(start)} → ${dm(nextDay(n))}`);
      start = null;
    }
  });
  return out.join(", ");
}

export function SplitStayPicker({
  grid,
  active,
  onActiveChange,
  picks,
  onPicksChange,
}: {
  grid: AvailabilityGrid;
  active: boolean;
  onActiveChange: (v: boolean) => void;
  picks: NightPicks;
  onPicksChange: (p: NightPicks) => void;
}) {
  const total = grid.nights.length;
  const partial = grid.rooms.filter((r) => r.freeNights > 0 && r.freeNights < total);
  const freeMap = new Map(grid.rooms.map((r) => [r.id, new Set(grid.nights.filter((_, i) => r.cells[i]!.state === "free"))]));
  const suggestion = suggestSplit(grid.nights, freeMap, grid.rooms.map((r) => r.id));
  const segments = segmentsFromPicks(grid.nights, picks);
  const numberOf = (id: string) => grid.rooms.find((r) => r.id === id)?.number ?? "?";
  const pickedCount = grid.nights.filter((n) => picks[n]).length;

  if (partial.length === 0 && !active) return null;

  return (
    <div className="space-y-3 rounded-md border border-dashed p-3" data-testid="split-stay">
      {partial.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-sm font-medium">Free for part of the stay</p>
          <ul className="space-y-1 text-sm" data-testid="partly-free-rooms">
            {partial.map((r) => (
              <li key={r.id} className="flex flex-wrap justify-between gap-x-3">
                <span><span className="font-semibold tabular-nums">{r.number}</span> · {r.categoryName}</span>
                <span className="text-muted-foreground">free {r.freeNights} of {total} nights · {freeWindows(r, grid.nights)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!active ? (
        total > 1 && suggestion ? (
          <Button
            type="button"
            variant="secondary"
            onClick={() => { onActiveChange(true); onPicksChange(suggestion); }}
            data-testid="split-stay-start"
          >
            Split this stay across rooms
          </Button>
        ) : total > 1 ? (
          <p className="text-sm text-muted-foreground">Some nights have no free room at all, so the stay can&apos;t be split for these dates.</p>
        ) : null
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            Tap a <b>Free</b> night to put the guest in that room for that night. One room per night; the bill stays one bill at one nightly rate.
          </p>
          <div className="flex flex-wrap gap-2">
            {suggestion && (
              <Button type="button" size="sm" variant="outline" onClick={() => onPicksChange(suggestion)} data-testid="split-stay-suggest">
                Suggest fewest room changes
              </Button>
            )}
            <Button type="button" size="sm" variant="ghost" onClick={() => onPicksChange({})}>Clear</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => { onActiveChange(false); onPicksChange({}); }}>
              Cancel split stay
            </Button>
          </div>
          <AvailabilityGridTable
            grid={grid}
            picks={picks}
            onPick={(night, roomId) => onPicksChange({ ...picks, [night]: roomId })}
          />
          <p className="rounded-md border bg-muted/40 p-2 text-sm" data-testid="split-stay-plan">
            {segments
              ? segments.map((s) => `${numberOf(s.roomId)}: ${dm(s.startDate)} → ${dm(s.endDate)}`).join("  ·  ")
              : `${pickedCount} of ${total} nights chosen — pick a room for every night.`}
          </p>
        </div>
      )}
    </div>
  );
}
