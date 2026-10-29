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
import { hasPermission } from "@/lib/permissions";
import { liveRoomStatus, roomDay, type RoomAllocationFact } from "./domain/live-status";

export type BoardRoom = {
  id: string;
  number: string;
  /** LIVE status, derived from today's bookings (see domain/live-status.ts). */
  status: RoomStatus;
  /** The stored status field — the manual transitions start from this. */
  storedStatus: RoomStatus;
  isActive: boolean;
  /** Who is in it / due today — guest name only for reservation:view holders. */
  booking: { reservationId: string; code: string; guestName: string | null; until: string } | null;
  /** The next booking that starts after today (free until then). */
  next: { reservationId: string; code: string; guestName: string | null; from: string } | null;
  departingToday: boolean;
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
  arrivingToday: number;
  departingToday: number;
  /** Property-local today (yyyy-mm-dd) the board was computed for. */
  today: string;
};

/** Bookings that can hold a room — a cancelled / no-show booking has no allocations left anyway. */
const LIVE_RES_STATUSES = ["ENQUIRY", "CONFIRMED", "IN_HOUSE"] as const;
/** How far ahead "next booking" looks. */
const NEXT_LOOKAHEAD_DAYS = 120;

async function roomFacts(
  scoped: ReturnType<typeof db.scoped>,
  where: { propertyId?: string },
  today: Date,
  showGuest: boolean,
): Promise<Map<string, RoomAllocationFact[]>> {
  const allocs = await scoped.roomAllocation.findMany({
    where: {
      ...where,
      endDate: { gte: today },
      startDate: { lte: new Date(today.getTime() + NEXT_LOOKAHEAD_DAYS * 86_400_000) },
      reservation: { status: { in: [...LIVE_RES_STATUSES] } },
    },
    select: {
      roomId: true, startDate: true, endDate: true,
      reservation: { select: { id: true, code: true, status: true, checkOutDate: true, guest: { select: { fullName: true } } } },
    },
  });
  const byRoom = new Map<string, RoomAllocationFact[]>();
  for (const a of allocs) {
    const fact: RoomAllocationFact = {
      roomId: a.roomId, startDate: a.startDate, endDate: a.endDate,
      reservation: { id: a.reservation.id, code: a.reservation.code, status: a.reservation.status, checkOutDate: a.reservation.checkOutDate, guestName: showGuest ? (a.reservation.guest?.fullName ?? null) : null },
    };
    byRoom.set(a.roomId, [...(byRoom.get(a.roomId) ?? []), fact]);
  }
  return byRoom;
}

/** The property-local calendar day as a UTC-midnight date (how `@db.Date` columns compare). */
function localToday(tz: string | null | undefined): Date {
  const s = new Date().toLocaleDateString("en-CA", { timeZone: tz || "Asia/Kolkata" });
  return new Date(`${s}T00:00:00.000Z`);
}

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

  const property = await scoped.property.findFirst({ where: { id: filter.propertyId }, select: { timezone: true } });
  const today = localToday(property?.timezone);
  const showGuest = hasPermission(user, "reservation:view");

  const rooms = await scoped.room.findMany({
    where: {
      propertyId: filter.propertyId,
      isActive: true,
      ...(filter.floorId ? { floorId: filter.floorId } : {}),
      ...(filter.categoryId ? { categoryId: filter.categoryId } : {}),
      // The status filter applies to the LIVE status, below.
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

  const [blocks, facts] = await Promise.all([
    scoped.roomBlock.findMany({
      where: {
        propertyId: filter.propertyId,
        startDate: { lte: today },
        endDate: { gt: today }, // half-open: a block ending today is already over
      },
      select: { roomId: true },
    }),
    roomFacts(scoped, { propertyId: filter.propertyId }, today, showGuest),
  ]);
  const blockedRoomIds = new Set(blocks.map((b) => b.roomId));

  const roles = user.roleAssignments.map((r) => r.role);
  const ymd = (d: Date) => d.toISOString().slice(0, 10);

  const all: BoardRoom[] = rooms.map((room) => {
    const day = roomDay(facts.get(room.id) ?? [], today);
    const blockedToday = blockedRoomIds.has(room.id);
    const status = liveRoomStatus({ stored: room.status, blockedToday, occupiedToday: !!day.occupant, arrivingToday: !!day.arrival });
    const holder = day.occupant ?? day.arrival;
    return {
      id: room.id,
      number: room.number,
      status,
      storedStatus: room.status,
      isActive: room.isActive,
      booking: holder ? { reservationId: holder.reservation.id, code: holder.reservation.code, guestName: holder.reservation.guestName, until: ymd(holder.endDate) } : null,
      next: day.next ? { reservationId: day.next.reservation.id, code: day.next.reservation.code, guestName: day.next.reservation.guestName, from: ymd(day.next.startDate) } : null,
      departingToday: day.departingToday,
      floorId: room.floorId,
      floorName: room.floor?.name ?? null,
      categoryId: room.categoryId,
      categoryName: room.category.name,
      // Manual transitions start from the STORED status — that is what
      // changeRoomStatus validates against.
      allowedTransitions: allowedTransitionsForRole(room.status, roles),
      blockedToday,
    };
  });

  const counts: Record<RoomStatus, number> = {
    VACANT: 0,
    OCCUPIED: 0,
    RESERVED: 0,
    UNDER_MAINTENANCE: 0,
    HOUSEKEEPING: 0,
  };
  for (const room of all) counts[room.status] += 1;
  const shown = filter.status ? all.filter((r) => r.status === filter.status) : all;

  return {
    rooms: shown,
    counts,
    total: shown.length,
    arrivingToday: all.filter((r) => r.status === "RESERVED").length,
    departingToday: all.filter((r) => r.departingToday).length,
    today: ymd(today),
  };
}

// ---------------------------------------------------------------------------
// All-properties rooms overview (02) — a cross-property, room-type-grouped view.
//
// IMPORTANT: status is derived from TODAY's bookings exactly like the property
// board (domain/live-status.ts) — never from the stored `room.status`, which can
// drift. A finished segment of a moved / split stay no longer counts as occupied.
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

const EFF: Record<RoomStatus, EffStatus> = {
  OCCUPIED: "OCCUPIED",
  RESERVED: "RESERVED",
  HOUSEKEEPING: "HOUSEKEEPING",
  UNDER_MAINTENANCE: "MAINTENANCE",
  VACANT: "AVAILABLE",
};

export async function roomsOverviewAll(user: SessionClaims): Promise<RoomsOverviewAll> {
  const scoped = db.scoped(user);
  const properties = await listProperties(user);
  const propMeta = new Map(properties.map((p) => [p.id, p]));
  // Every property here runs on IST; one "today" keeps the rollup to one query.
  const tzRow = await scoped.property.findFirst({ select: { timezone: true } });
  const today = localToday(tzRow?.timezone);

  const [rooms, facts, blocks] = await Promise.all([
    scoped.room.findMany({
      where: { isActive: true },
      select: { id: true, propertyId: true, status: true, category: { select: { name: true } } },
    }),
    roomFacts(scoped, {}, today, false),
    scoped.roomBlock.findMany({
      where: { startDate: { lte: today }, endDate: { gt: today } },
      select: { roomId: true },
    }),
  ]);
  const blockedIds = new Set(blocks.map((b) => b.roomId));
  // Same derivation as the single-property board, so the two never disagree.
  const effectiveStatus = (roomId: string, stored: RoomStatus): EffStatus => {
    const day = roomDay(facts.get(roomId) ?? [], today);
    return EFF[liveRoomStatus({ stored, blockedToday: blockedIds.has(roomId), occupiedToday: !!day.occupant, arrivingToday: !!day.arrival })];
  };

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
    const eff = effectiveStatus(room.id, room.status);
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
