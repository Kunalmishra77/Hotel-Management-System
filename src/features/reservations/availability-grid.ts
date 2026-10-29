/**
 * Room × night availability grid — what is free, booked or out of order on each
 * night of a range. NOT a "use server" module (plain helper behind the booking
 * form's split-stay picker and the Rooms calendar).
 *
 * Uses the SAME truth as `findFreeRooms` (allocations + blocks + an
 * under-maintenance room is unsellable), so a night the grid shows as free is a
 * night the booking transaction will accept.
 */
import type { reservationDb } from "./internal";
import { overlapWhere } from "./internal";
import { stayNightKeys } from "./domain/split-stay";

export type GridCell =
  | { state: "free" }
  | { state: "booked"; reservationId: string; code: string; status: string; guestName: string | null; startsHere: boolean }
  | { state: "blocked"; reason: string };

export type GridRoom = {
  id: string;
  number: string;
  categoryId: string;
  categoryName: string;
  baseRatePaise: number;
  floorName: string | null;
  cells: GridCell[];
  freeNights: number;
};

export type AvailabilityGrid = { nights: string[]; rooms: GridRoom[] };

/** At most this many nights in one grid — keeps the query and the table bounded. */
export const GRID_MAX_NIGHTS = 62;

const day = (d: string) => new Date(`${d}T00:00:00Z`);
const key = (d: Date) => d.toISOString().slice(0, 10);

export async function availabilityGrid(
  client: ReturnType<typeof reservationDb>,
  input: { propertyId: string; from: string; to: string; categoryId?: string; showGuest: boolean },
): Promise<AvailabilityGrid> {
  const nights = stayNightKeys(input.from, input.to).slice(0, GRID_MAX_NIGHTS);
  if (nights.length === 0) return { nights, rooms: [] };
  const start = day(nights[0]!);
  const end = new Date(day(nights[nights.length - 1]!).getTime() + 86_400_000);
  const overlap = overlapWhere(start, end);

  const rooms = await client.room.findMany({
    where: { propertyId: input.propertyId, isActive: true, ...(input.categoryId ? { categoryId: input.categoryId } : {}) },
    select: {
      id: true, number: true, status: true, categoryId: true,
      category: { select: { name: true, baseRatePaise: true } },
      floor: { select: { name: true } },
      allocations: {
        where: overlap,
        select: {
          startDate: true, endDate: true,
          reservation: { select: { id: true, code: true, status: true, guest: { select: { fullName: true } } } },
        },
      },
      blocks: { where: overlap, select: { startDate: true, endDate: true, reason: true } },
    },
    orderBy: [{ floorId: "asc" }, { number: "asc" }],
  });

  return {
    nights,
    rooms: rooms.map((r) => {
      const cells: GridCell[] = nights.map((n) => {
        const t = day(n).getTime();
        const covers = (s: Date, e: Date) => s.getTime() <= t && e.getTime() > t;
        const a = r.allocations.find((x) => covers(x.startDate, x.endDate));
        if (a) {
          return {
            state: "booked",
            reservationId: a.reservation.id,
            code: a.reservation.code,
            status: a.reservation.status,
            // Guest name only for callers allowed to see bookings (housekeeping sees "Booked").
            guestName: input.showGuest ? (a.reservation.guest?.fullName ?? null) : null,
            startsHere: key(a.startDate) === n,
          };
        }
        const b = r.blocks.find((x) => covers(x.startDate, x.endDate));
        if (b) return { state: "blocked", reason: b.reason };
        // Mirrors findFreeRooms: a room whose status is under-maintenance isn't sold.
        if (r.status === "UNDER_MAINTENANCE") return { state: "blocked", reason: "Under maintenance" };
        return { state: "free" };
      });
      return {
        id: r.id,
        number: r.number,
        categoryId: r.categoryId,
        categoryName: r.category.name,
        baseRatePaise: r.category.baseRatePaise,
        floorName: r.floor?.name ?? null,
        cells,
        freeNights: cells.filter((c) => c.state === "free").length,
      };
    }),
  };
}
