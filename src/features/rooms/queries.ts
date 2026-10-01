/**
 * Room queries — 02 T-12 (FR-9/FR-10, AC-10).
 *
 * Takes claims explicitly rather than resolving a session (same layering rule
 * as 01): queries are the data layer, session resolution is the application's
 * job, and it keeps this module free of the Auth.js import chain.
 */
import type { RoomStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { assertPropertyInScope } from "@/lib/db";
import type { SessionClaims } from "@/lib/auth/claims";
import type { RoomBoardFilter } from "./schema";
import { allowedTransitionsForRole } from "./domain/transitions";
import { listProperties } from "@/features/properties/queries";

export type BoardRoom = {
  id: string;
  number: string;
  status: RoomStatus;
  isActive: boolean;
  floorId: string | null;
  floorName: string | null;
  categoryId: string;
  categoryName: string;
  /** Transitions THIS caller may drive — powers the action sheet (AC-5/AC-7). */
  allowedTransitions: RoomStatus[];
  /** True when a block covers today — the board shows it as out of order. */
  blockedToday: boolean;
};

export type RoomBoard = {
  rooms: BoardRoom[];
  counts: Record<RoomStatus, number>;
  total: number;
};

/**
 * The room board (FR-9, AC-10).
 *
 * One query for rooms with their category/floor joined, plus one for today's
 * blocks — not a per-room fetch. At 200 rooms this is two round trips, which is
 * what keeps it inside the p95 < 1.5s budget.
 */
export async function roomBoard(
  user: SessionClaims,
  filter: RoomBoardFilter,
): Promise<RoomBoard> {
  assertPropertyInScope(user, filter.propertyId);
  const scoped = db.scoped(user);

  const rooms = await scoped.room.findMany({
    where: {
      propertyId: filter.propertyId,
      isActive: true,
      ...(filter.floorId ? { floorId: filter.floorId } : {}),
      ...(filter.categoryId ? { categoryId: filter.categoryId } : {}),
      ...(filter.status ? { status: filter.status } : {}),
    },
    select: {
      id: true,
      number: true,
      status: true,
      isActive: true,
      floorId: true,
      categoryId: true,
      floor: { select: { name: true } },
      category: { select: { name: true } },
    },
    // Room numbers are strings ("101", "9A"), so sort by floor then number and
    // let the UI group. A numeric sort would need a schema change.
    orderBy: [{ floorId: "asc" }, { number: "asc" }],
  });

  const today = startOfUtcDay(new Date());
  const blocks = await scoped.roomBlock.findMany({
    where: {
      propertyId: filter.propertyId,
      startDate: { lte: today },
      endDate: { gt: today }, // half-open: a block ending today is already over
    },
    select: { roomId: true },
  });
  const blockedRoomIds = new Set(blocks.map((b) => b.roomId));

  const roles = user.roleAssignments.map((r) => r.role);

  const counts: Record<RoomStatus, number> = {
    VACANT: 0,
    OCCUPIED: 0,
    RESERVED: 0,
    UNDER_MAINTENANCE: 0,
    HOUSEKEEPING: 0,
  };
  for (const room of rooms) counts[room.status] += 1;

  return {
    rooms: rooms.map((room) => ({
      id: room.id,
      number: room.number,
      status: room.status,
      isActive: room.isActive,
      floorId: room.floorId,
      floorName: room.floor?.name ?? null,
      categoryId: room.categoryId,
      categoryName: room.category.name,
      allowedTransitions: allowedTransitionsForRole(room.status, roles),
      blockedToday: blockedRoomIds.has(room.id),
    })),
    counts,
    total: rooms.length,
  };
}

// ---------------------------------------------------------------------------
// All-properties rooms overview (02) — a cross-property, room-type-grouped view.
//
// IMPORTANT: "occupied" is derived from who is actually IN-HOUSE (the allocation
// truth), NOT from the stored `room.status` field, which can drift (e.g. a
// historical/Data-Entry in-house stay allocates the room but never flips its
// status to OCCUPIED). Deriving from allocations makes the counts correct even
// when the status field is stale. Non-occupied rooms then take their state from
// room.status (maintenance / housekeeping / reserved), and a block covering today
// counts as out-of-order.
// ---------------------------------------------------------------------------

export type RoomTypeRow = {
  categoryName: string;
  total: number;
  occupied: number;
  reserved: number;
  housekeeping: number;
  maintenance: number;
  available: number;
};
export type PropertyRoomRollup = {
  id: string;
  name: string;
  city: string;
  state: string;
  total: number;
  occupied: number;
  available: number;
  reserved: number;
  housekeeping: number;
  maintenance: number;
  occupancyBps: number;
};
export type RoomsOverviewAll = {
  byType: RoomTypeRow[];
  totals: RoomTypeRow;
  byProperty: PropertyRoomRollup[];
};

type EffStatus = "OCCUPIED" | "RESERVED" | "HOUSEKEEPING" | "MAINTENANCE" | "AVAILABLE";

function effectiveStatus(roomId: string, status: RoomStatus, occupied: Set<string>, blocked: Set<string>): EffStatus {
  if (occupied.has(roomId)) return "OCCUPIED"; // an in-house guest is in it right now
  if (blocked.has(roomId) || status === "UNDER_MAINTENANCE") return "MAINTENANCE";
  if (status === "HOUSEKEEPING") return "HOUSEKEEPING";
  if (status === "RESERVED") return "RESERVED";
  return "AVAILABLE";
}

export async function roomsOverviewAll(user: SessionClaims): Promise<RoomsOverviewAll> {
  const scoped = db.scoped(user);
  const today = startOfUtcDay(new Date());
  const properties = await listProperties(user);
  const propMeta = new Map(properties.map((p) => [p.id, p]));

  const [rooms, inHouse, blocks] = await Promise.all([
    scoped.room.findMany({
      where: { isActive: true },
      select: { id: true, propertyId: true, status: true, category: { select: { name: true } } },
    }),
    scoped.reservation.findMany({
      where: { status: "IN_HOUSE" },
      select: { allocations: { select: { roomId: true } } },
    }),
    scoped.roomBlock.findMany({
      where: { startDate: { lte: today }, endDate: { gt: today } },
      select: { roomId: true },
    }),
  ]);

  const occupiedIds = new Set<string>();
  for (const r of inHouse) for (const a of r.allocations) occupiedIds.add(a.roomId);
  const blockedIds = new Set(blocks.map((b) => b.roomId));

  const blankType = (name: string): RoomTypeRow => ({ categoryName: name, total: 0, occupied: 0, reserved: 0, housekeeping: 0, maintenance: 0, available: 0 });
  const typeMap = new Map<string, RoomTypeRow>();
  const totals = blankType("All room types");
  const propMap = new Map<string, PropertyRoomRollup>();

  const bump = (row: RoomTypeRow | PropertyRoomRollup, eff: EffStatus) => {
    row.total += 1;
    if (eff === "OCCUPIED") row.occupied += 1;
    else if (eff === "MAINTENANCE") row.maintenance += 1;
    else if (eff === "HOUSEKEEPING") row.housekeeping += 1;
    else if (eff === "RESERVED") row.reserved += 1;
    else row.available += 1;
  };

  for (const room of rooms) {
    const eff = effectiveStatus(room.id, room.status, occupiedIds, blockedIds);
    const name = room.category.name;
    const trow = typeMap.get(name) ?? blankType(name);
    bump(trow, eff);
    typeMap.set(name, trow);
    bump(totals, eff);

    const meta = propMeta.get(room.propertyId);
    const prow = propMap.get(room.propertyId) ?? {
      id: room.propertyId, name: meta?.name ?? "—", city: meta?.city ?? "", state: meta?.state ?? "",
      total: 0, occupied: 0, available: 0, reserved: 0, housekeeping: 0, maintenance: 0, occupancyBps: 0,
    };
    bump(prow, eff);
    propMap.set(room.propertyId, prow);
  }

  const byProperty = [...propMap.values()].map((p) => {
    const denom = p.total - p.maintenance; // maintenance rooms aren't sellable (reporting.md)
    return { ...p, occupancyBps: denom > 0 ? Math.min(10_000, Math.round((p.occupied * 10_000) / denom)) : 0 };
  });
  // Keep property order stable (A–Z by name), and room types A–Z.
  byProperty.sort((a, b) => a.name.localeCompare(b.name));
  const byType = [...typeMap.values()].sort((a, b) => a.categoryName.localeCompare(b.categoryName));

  return { byType, totals, byProperty };
}

export type CategoryListItem = {
  id: string;
  name: string;
  baseRatePaise: number;
  maxAdults: number;
  maxChildren: number;
  hsnSac: string | null;
  roomCount: number;
};

export async function listCategories(
  user: SessionClaims,
  propertyId: string,
): Promise<CategoryListItem[]> {
  assertPropertyInScope(user, propertyId);
  const scoped = db.scoped(user);

  const categories = await scoped.roomCategory.findMany({
    where: { propertyId },
    select: {
      id: true,
      name: true,
      baseRatePaise: true,
      maxAdults: true,
      maxChildren: true,
      hsnSac: true,
      _count: { select: { rooms: true } },
    },
    orderBy: { name: "asc" },
  });

  return categories.map((c) => ({
    id: c.id,
    name: c.name,
    baseRatePaise: c.baseRatePaise,
    maxAdults: c.maxAdults,
    maxChildren: c.maxChildren,
    hsnSac: c.hsnSac,
    roomCount: c._count.rooms,
  }));
}

/** Blocks on a room, newest first — for the room detail sheet. */
export async function listRoomBlocks(
  user: SessionClaims,
  roomId: string,
): Promise<{ id: string; startDate: Date; endDate: Date; reason: string }[]> {
  const scoped = db.scoped(user);
  return scoped.roomBlock.findMany({
    where: { roomId },
    select: { id: true, startDate: true, endDate: true, reason: true },
    orderBy: { startDate: "desc" },
  });
}

/** Midnight UTC — `@db.Date` columns compare against a date, not an instant. */
function startOfUtcDay(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
}
