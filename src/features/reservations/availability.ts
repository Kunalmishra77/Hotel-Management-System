/**
 * Availability core — 03 T-11 (FR-2, AC-7/9/10). NOT a "use server" module: it
 * holds server-side helpers reused by both the `searchAvailability` action and
 * the booking transaction's re-check, so it must export plain functions.
 *
 * Availability = allocations + blocks, never room status alone (database-setup.md).
 * A room is sellable for `[checkIn, checkOut)` iff it is active, not itself under
 * maintenance, AND has NO overlapping `RoomAllocation` (incl. live holds) AND NO
 * overlapping `RoomBlock` (02-owned). Both exclusions use the SAME `overlapWhere`
 * the booking transaction uses, so search and booking can never disagree.
 */
import { overlapWhere } from "./internal";

export type AvailableRoom = {
  id: string;
  number: string;
  categoryId: string;
  categoryName: string;
  baseRatePaise: number;
};

type RoomRow = {
  id: string;
  number: string;
  categoryId: string;
  category: { name: string; baseRatePaise: number };
};

/**
 * Minimum client shape both the action (scoped client) and the booking tx pass
 * in. Prisma's `findMany` is heavily overloaded, so the extended/tx clients are
 * not structurally assignable to a single-signature interface — callers pass
 * them with a documented `as unknown as RoomFinder` cast. Runtime behaviour is
 * identical; only the static shape is narrowed to what this module uses.
 */
export type RoomFinder = {
  room: {
    findMany(args: {
      where: Record<string, unknown>;
      select: Record<string, unknown>;
      orderBy?: Record<string, unknown>;
    }): Promise<RoomRow[]>;
  };
};

/**
 * Rooms in a property free for the range, optionally filtered to a category and
 * an occupancy the category can hold, or to a specific candidate set. Shared by
 * search and the booking re-check.
 */
export async function findFreeRooms(
  client: RoomFinder,
  input: {
    propertyId: string;
    checkInDate: Date;
    checkOutDate: Date;
    categoryId?: string;
    adults?: number;
    children?: number;
    roomIds?: string[];
  },
): Promise<AvailableRoom[]> {
  const overlap = overlapWhere(input.checkInDate, input.checkOutDate);
  const rows = await client.room.findMany({
    where: {
      propertyId: input.propertyId,
      isActive: true,
      status: { not: "UNDER_MAINTENANCE" },
      ...(input.categoryId ? { categoryId: input.categoryId } : {}),
      ...(input.roomIds ? { id: { in: input.roomIds } } : {}),
      ...(input.adults != null || input.children != null
        ? {
            category: {
              ...(input.adults != null ? { maxAdults: { gte: input.adults } } : {}),
              ...(input.children != null ? { maxChildren: { gte: input.children } } : {}),
            },
          }
        : {}),
      // The two anti-overbooking exclusions.
      allocations: { none: overlap },
      blocks: { none: overlap },
    },
    select: {
      id: true,
      number: true,
      categoryId: true,
      category: { select: { name: true, baseRatePaise: true } },
    },
    orderBy: { number: "asc" },
  });

  return rows.map((r) => ({
    id: r.id,
    number: r.number,
    categoryId: r.categoryId,
    categoryName: r.category.name,
    baseRatePaise: r.category.baseRatePaise,
  }));
}

/** Which of `roomIds` are free for the range — the booking tx's re-check. */
export async function freeRoomIdsFor(
  client: RoomFinder,
  propertyId: string,
  roomIds: string[],
  checkInDate: Date,
  checkOutDate: Date,
): Promise<Set<string>> {
  const free = await findFreeRooms(client, { propertyId, roomIds, checkInDate, checkOutDate });
  return new Set(free.map((r) => r.id));
}
