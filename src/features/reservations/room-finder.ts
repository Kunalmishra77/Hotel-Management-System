/**
 * "A guest calls: do you have a room from 25 Nov to 25 Dec?" (client, 20 Nov
 * 2026). For each hotel in scope, over the asked dates, answers from the SAME
 * truth the booking transaction uses (allocations + blocks + out-of-order —
 * availability-grid.ts):
 *  - rooms free for the WHOLE stay, with an estimated bill;
 *  - a split-stay plan (fewest room changes) when no single room is free throughout;
 *  - rooms free for PART of the stay — which nights are free and what blocks the rest.
 * Read-only. Guest names only with reservation:view (as on the grid).
 */
import { db } from "@/lib/db";
import { authorize, hasPermission } from "@/lib/permissions";
import { roomGstBps } from "@/lib/constants/gst";
import type { SessionClaims } from "@/lib/auth/claims";
import { availabilityGrid, GRID_MAX_NIGHTS, type GridCell, type GridRoom } from "./availability-grid";

export type FinderRange = { from: string; to: string }; // [from, to) as check-in / check-out dates
export type FinderRoom = {
  id: string;
  number: string;
  categoryName: string;
  floorName: string | null;
  ratePaise: number;
  /** Estimated bill for the asked stay at the room type's rate, GST included. */
  estimatePaise: number;
};
export type PartialRoom = FinderRoom & {
  freeNights: number;
  free: FinderRange[];
  /** What fills the other nights: a booking (code / guest) or an out-of-order block. */
  busy: (FinderRange & { label: string; reservationId?: string })[];
};
export type SplitPlan = { segments: (FinderRange & { roomId: string; number: string })[]; estimatePaise: number };
export type HotelAvailability = {
  propertyId: string;
  propertyName: string;
  whole: FinderRoom[];
  split: SplitPlan | null;
  partial: PartialRoom[];
};
export type RoomFinderResult = { from: string; to: string; nights: number; capped: boolean; hotels: HotelAvailability[] };

const DAY = 86_400_000;
const addDays = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

/** Room-type rate × nights + GST at the rate's slab (estimate; the booking can still set its own rate). */
function estimate(ratePaise: number, nights: number): number {
  const gst = Math.round((ratePaise * roomGstBps(ratePaise)) / 10_000);
  return (ratePaise + gst) * nights;
}

/** Consecutive runs of nights (as [from, to) date ranges) for which `test` holds. */
function runs(nights: string[], test: (i: number) => boolean): FinderRange[] {
  const out: FinderRange[] = [];
  let start = -1;
  for (let i = 0; i <= nights.length; i++) {
    const on = i < nights.length && test(i);
    if (on && start < 0) start = i;
    if (!on && start >= 0) { out.push({ from: nights[start]!, to: addDays(nights[i - 1]!, 1) }); start = -1; }
  }
  return out;
}

/**
 * Fewest room changes: from each night, take the free room whose free run
 * reaches furthest (staying put when it ties). Null when some night has no free
 * room at all, or it would take more than 3 rooms (not a practical offer).
 */
function splitPlan(nights: string[], rooms: GridRoom[]): SplitPlan | null {
  const segments: SplitPlan["segments"] = [];
  let i = 0;
  let current: GridRoom | null = null;
  let est = 0;
  while (i < nights.length) {
    let best: { room: GridRoom; end: number } | null = null;
    for (const r of rooms) {
      let j = i;
      while (j < nights.length && r.cells[j]?.state === "free") j++;
      if (j > i && (!best || j > best.end || (j === best.end && r.id === current?.id))) best = { room: r, end: j };
    }
    if (!best) return null;
    segments.push({ roomId: best.room.id, number: best.room.number, from: nights[i]!, to: addDays(nights[best.end - 1]!, 1) });
    est += estimate(best.room.baseRatePaise, best.end - i);
    current = best.room;
    i = best.end;
  }
  return segments.length >= 2 && segments.length <= 3 ? { segments, estimatePaise: est } : null;
}

export async function findRoomsForDates(
  user: SessionClaims,
  input: { from: string; to: string; propertyIds: string[] },
): Promise<RoomFinderResult> {
  for (const id of input.propertyIds) authorize(user, "room:view-status", id);
  const showGuest = hasPermission(user, "reservation:view");
  const totalNights = Math.max(0, Math.round((Date.parse(input.to) - Date.parse(input.from)) / DAY));
  const to = totalNights > GRID_MAX_NIGHTS ? addDays(input.from, GRID_MAX_NIGHTS) : input.to;
  const scoped = db.scoped(user);
  const props = await scoped.property.findMany({
    where: { id: { in: input.propertyIds }, isCostCenter: false },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const hotels = await Promise.all(props.map(async (p): Promise<HotelAvailability> => {
    const grid = await availabilityGrid(scoped, { propertyId: p.id, from: input.from, to, showGuest });
    const n = grid.nights.length;
    const base = (r: GridRoom): FinderRoom => ({
      id: r.id, number: r.number, categoryName: r.categoryName, floorName: r.floorName,
      ratePaise: r.baseRatePaise, estimatePaise: estimate(r.baseRatePaise, n),
    });
    const whole = grid.rooms.filter((r) => r.freeNights === n).map(base);
    const partial = grid.rooms
      .filter((r) => r.freeNights > 0 && r.freeNights < n)
      .sort((a, b) => b.freeNights - a.freeNights)
      .map((r): PartialRoom => {
        const busy: PartialRoom["busy"] = [];
        // One entry per booking / block run, in date order.
        let k = 0;
        while (k < n) {
          const c = r.cells[k]!;
          if (c.state === "free") { k++; continue; }
          let e = k + 1;
          const same = (x: GridCell) => (c.state === "booked" && x.state === "booked" ? x.reservationId === c.reservationId : x.state === c.state);
          while (e < n && same(r.cells[e]!)) e++;
          busy.push({
            from: grid.nights[k]!, to: addDays(grid.nights[e - 1]!, 1),
            label: c.state === "booked" ? `${c.code}${c.guestName ? ` · ${c.guestName}` : ""}` : `Out of order${c.state === "blocked" && c.reason ? ` · ${c.reason}` : ""}`,
            ...(c.state === "booked" ? { reservationId: c.reservationId } : {}),
          });
          k = e;
        }
        return { ...base(r), freeNights: r.freeNights, free: runs(grid.nights, (i) => r.cells[i]?.state === "free"), busy };
      });
    return {
      propertyId: p.id,
      propertyName: p.name,
      whole,
      split: whole.length === 0 ? splitPlan(grid.nights, grid.rooms) : null,
      partial,
    };
  }));
  return { from: input.from, to, nights: Math.min(totalNights, GRID_MAX_NIGHTS), capped: totalNights > GRID_MAX_NIGHTS, hotels };
}
