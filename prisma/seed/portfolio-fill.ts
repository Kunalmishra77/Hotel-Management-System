/**
 * Portfolio fill — brings the FOUR currently-empty portfolio properties to life
 * so the consolidated "all hotels" super-admin view (Rooms / Bookings /
 * Dashboard) is never empty. The flagship WMG (`prop_wmg`) is already richly
 * seeded by `29-demo-rich.ts`; this file does the equivalent *lean* fill for:
 *
 *   prop_whs — Woodpecker HSR Layout
 *   prop_wir — Woodpecker Indiranagar
 *   prop_wko — Woodpecker Koramangala
 *   prop_wwf — Woodpecker Whitefield
 *
 * Each property gets: 2 room categories (Deluxe / Suite), 2 floors, 12 rooms
 * with a realistic live-status spread, 8 guests, and 10 reservations across the
 * lifecycle (IN_HOUSE with allocations → OCCUPIED rooms, CONFIRMED arriving &
 * future, CHECKED_OUT history, ENQUIRY, CANCELLED). Intentionally lean — NO
 * folios / payments / invoices; rooms + guests + reservations + allocations are
 * enough to make the operational pages look alive.
 *
 * Idempotent by construction: every write is a fixed-id upsert, and the whole
 * per-property block is guarded by a room-count check — a property that already
 * has rooms is skipped, so re-running is a no-op and the flagship is never
 * touched. Dates are property-local `@db.Date`, computed relative to TODAY (UTC
 * midnight) inside the function — never at module scope. Money is integer paise;
 * `ratePaise` / `taxPaise` / `advancePaise` are `Int` per the schema.
 */
import type {
  PrismaClient,
  BookingSource,
  ReservationStatus,
  RoomStatus,
} from "@prisma/client";
import { encryptString, keyedHash } from "../../src/lib/crypto/encryption";
import { normalizePhone } from "../../src/features/guests/domain/normalize";
import { ORG_ID } from "./fixtures";

// ---------------------------------------------------------------------------
// Per-property configuration
// ---------------------------------------------------------------------------
interface PortfolioProperty {
  id: string;
  /** short code used to prefix deterministic ids (e.g. "whs" → `room_whs_101`) */
  code: string;
  state: string;
  /** base for unique 10-digit mobile numbers; +i stays a valid 10-digit string */
  mobileBase: number;
  deluxeRatePaise: number;
  suiteRatePaise: number;
}

const PROPERTIES: PortfolioProperty[] = [
  { id: "prop_whs", code: "whs", state: "Karnataka", mobileBase: 9720000000, deluxeRatePaise: 350_000, suiteRatePaise: 650_000 },
  { id: "prop_wir", code: "wir", state: "Karnataka", mobileBase: 9730000000, deluxeRatePaise: 380_000, suiteRatePaise: 680_000 },
  { id: "prop_wko", code: "wko", state: "Karnataka", mobileBase: 9740000000, deluxeRatePaise: 420_000, suiteRatePaise: 720_000 },
  { id: "prop_wwf", code: "wwf", state: "Karnataka", mobileBase: 9750000000, deluxeRatePaise: 330_000, suiteRatePaise: 600_000 },
];

// ---------------------------------------------------------------------------
// Guests — 8 per property (names + home city/state for a plausible CRM)
// ---------------------------------------------------------------------------
const GUEST_TEMPLATES: { fullName: string; city: string; state: string; company?: string }[] = [
  { fullName: "Aditya Menon", city: "Bengaluru", state: "Karnataka" },
  { fullName: "Sneha Reddy", city: "Hyderabad", state: "Telangana", company: "Zensar" },
  { fullName: "Rahul Bansal", city: "Delhi", state: "Delhi" },
  { fullName: "Priya Deshmukh", city: "Pune", state: "Maharashtra" },
  { fullName: "Vivek Nair", city: "Chennai", state: "Tamil Nadu", company: "TCS" },
  { fullName: "Ananya Ghosh", city: "Kolkata", state: "West Bengal" },
  { fullName: "Karan Malhotra", city: "Mumbai", state: "Maharashtra" },
  { fullName: "Deepika Rao", city: "Bengaluru", state: "Karnataka" },
];

// ---------------------------------------------------------------------------
// Rooms — 12 per property: 101-106 Deluxe (floor 1), 201-206 Suite (floor 2).
// Live status comes from reservations (OCCUPIED / RESERVED) plus two explicit
// non-sellable rooms so the maintenance / housekeeping boards are non-empty.
// ---------------------------------------------------------------------------
const DELUXE_NUMBERS = ["101", "102", "103", "104", "105", "106"];
const SUITE_NUMBERS = ["201", "202", "203", "204", "205", "206"];
/** Explicit out-of-inventory rooms (not driven by any reservation). */
const MAINTENANCE_ROOM = "106";
const HOUSEKEEPING_ROOM = "205";

// ---------------------------------------------------------------------------
// Reservation plan — 10 per property. `room` null ⇒ no allocation.
// `liveRoomStatus` forces the room's current status (IN_HOUSE → OCCUPIED,
// arriving-today CONFIRMED → RESERVED). Future CONFIRMED leave the room VACANT
// now (they only consume inventory in their future window).
// ---------------------------------------------------------------------------
interface ResSpec {
  status: ReservationStatus;
  room: string | null;
  ci: number; // check-in offset in days from today (negative = past)
  co: number; // check-out offset
  adults: number;
  children: number;
  source: BookingSource;
  advancePaise: number;
  liveRoomStatus?: RoomStatus;
}

const RES_SPECS: ResSpec[] = [
  // 3 in-house now → their rooms are OCCUPIED
  { status: "IN_HOUSE", room: "101", ci: -2, co: 2, adults: 2, children: 0, source: "WALK_IN", advancePaise: 200_000, liveRoomStatus: "OCCUPIED" },
  { status: "IN_HOUSE", room: "201", ci: -1, co: 3, adults: 2, children: 1, source: "WEBSITE", advancePaise: 300_000, liveRoomStatus: "OCCUPIED" },
  { status: "IN_HOUSE", room: "102", ci: -3, co: 1, adults: 1, children: 0, source: "BOOKING_COM", advancePaise: 150_000, liveRoomStatus: "OCCUPIED" },
  // 1 arriving today → room RESERVED
  { status: "CONFIRMED", room: "103", ci: 0, co: 2, adults: 2, children: 0, source: "DIRECT", advancePaise: 0, liveRoomStatus: "RESERVED" },
  // 2 future confirmed → rooms stay VACANT today
  { status: "CONFIRMED", room: "202", ci: 3, co: 5, adults: 2, children: 0, source: "AGODA", advancePaise: 400_000 },
  { status: "CONFIRMED", room: "203", ci: 5, co: 8, adults: 2, children: 1, source: "WEBSITE", advancePaise: 0 },
  // 2 checked-out history (past, non-overlapping)
  { status: "CHECKED_OUT", room: "104", ci: -20, co: -18, adults: 1, children: 0, source: "WALK_IN", advancePaise: 0 },
  { status: "CHECKED_OUT", room: "204", ci: -15, co: -12, adults: 2, children: 0, source: "BOOKING_COM", advancePaise: 0 },
  // 1 enquiry (hold, no room)
  { status: "ENQUIRY", room: null, ci: 10, co: 12, adults: 2, children: 0, source: "WEBSITE", advancePaise: 0 },
  // 1 cancelled (no room)
  { status: "CANCELLED", room: null, ci: 6, co: 8, adults: 2, children: 0, source: "DIRECT", advancePaise: 0 },
];

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------
export async function seedPortfolioFill(prisma: PrismaClient): Promise<void> {
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  /** A property-local `@db.Date`, `n` days from today (negative = past). */
  const day = (n: number): Date => {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() + n);
    return d;
  };
  /** A wall-clock instant on a local date at `hour`. */
  const at = (date: Date, hour: number): Date => new Date(date.getTime() + hour * 3_600_000);

  for (const p of PROPERTIES) {
    // Idempotency guard: a property that already has rooms is fully seeded —
    // skip it so re-runs are a no-op and the flagship is never touched.
    const existingRooms = await prisma.room.count({ where: { propertyId: p.id } });
    if (existingRooms > 0) continue;

    const deluxeCatId = `cat_${p.code}_deluxe`;
    const suiteCatId = `cat_${p.code}_suite`;
    const floor1Id = `floor_${p.code}_1`;
    const floor2Id = `floor_${p.code}_2`;

    // --- Floors -----------------------------------------------------------
    await prisma.floor.upsert({
      where: { id: floor1Id },
      create: { id: floor1Id, propertyId: p.id, name: "1", sortOrder: 1 },
      update: { name: "1", sortOrder: 1 },
    });
    await prisma.floor.upsert({
      where: { id: floor2Id },
      create: { id: floor2Id, propertyId: p.id, name: "2", sortOrder: 2 },
      update: { name: "2", sortOrder: 2 },
    });

    // --- Room categories --------------------------------------------------
    await prisma.roomCategory.upsert({
      where: { id: deluxeCatId },
      create: {
        id: deluxeCatId,
        propertyId: p.id,
        name: "Deluxe",
        baseRatePaise: p.deluxeRatePaise,
        hsnSac: "996311",
        gstBps: 1200,
        maxAdults: 2,
        maxChildren: 1,
      },
      update: {},
    });
    await prisma.roomCategory.upsert({
      where: { id: suiteCatId },
      create: {
        id: suiteCatId,
        propertyId: p.id,
        name: "Suite",
        baseRatePaise: p.suiteRatePaise,
        hsnSac: "996311",
        gstBps: 1200,
        maxAdults: 3,
        maxChildren: 2,
      },
      update: {},
    });

    // --- Rooms ------------------------------------------------------------
    // Live status: reservation-driven first, then the two explicit OOO rooms.
    const roomStatusOverride = new Map<string, RoomStatus>();
    for (const s of RES_SPECS) {
      if (s.room && s.liveRoomStatus) roomStatusOverride.set(s.room, s.liveRoomStatus);
    }
    roomStatusOverride.set(MAINTENANCE_ROOM, "UNDER_MAINTENANCE");
    roomStatusOverride.set(HOUSEKEEPING_ROOM, "HOUSEKEEPING");

    const roomId = (number: string): string => `room_${p.code}_${number}`;
    const roomDefs: { number: string; floorId: string; categoryId: string }[] = [
      ...DELUXE_NUMBERS.map((number) => ({ number, floorId: floor1Id, categoryId: deluxeCatId })),
      ...SUITE_NUMBERS.map((number) => ({ number, floorId: floor2Id, categoryId: suiteCatId })),
    ];
    for (const r of roomDefs) {
      const id = roomId(r.number);
      const status: RoomStatus = roomStatusOverride.get(r.number) ?? "VACANT";
      await prisma.room.upsert({
        where: { id },
        create: {
          id,
          propertyId: p.id,
          floorId: r.floorId,
          categoryId: r.categoryId,
          number: r.number,
          status,
          isActive: true,
        },
        update: { status, isActive: true },
      });
    }

    // --- Guests -----------------------------------------------------------
    const guestId = (i: number): string => `guest_${p.code}_${String(i + 1).padStart(2, "0")}`;
    for (let i = 0; i < GUEST_TEMPLATES.length; i++) {
      const g = GUEST_TEMPLATES[i]!;
      const id = guestId(i);
      // Unique 10-digit mobile per property+index → unique keyedHash per org.
      const mobile = String(p.mobileBase + i);
      const data = {
        orgId: ORG_ID,
        fullName: g.fullName,
        mobile: encryptString(mobile),
        mobileHash: keyedHash(normalizePhone(mobile) ?? mobile),
        city: g.city,
        state: g.state,
        companyName: g.company ?? null,
        deletedAt: null,
        mergedIntoId: null,
      };
      await prisma.guest.upsert({ where: { id }, create: { id, ...data }, update: data });
    }

    // --- Reservations -----------------------------------------------------
    const reservationIds: string[] = [];
    for (let i = 0; i < RES_SPECS.length; i++) {
      const s = RES_SPECS[i]!;
      const rid = `res_${p.code}_${String(i + 1).padStart(2, "0")}`;
      reservationIds.push(rid);
      const code = `PF-${p.code.toUpperCase()}-${String(i + 1).padStart(2, "0")}`;
      const checkInDate = day(s.ci);
      const checkOutDate = day(s.co);
      const nights = Math.max(1, s.co - s.ci);
      const isSuite = s.room ? s.room.startsWith("2") : false;
      const ratePaise = isSuite ? p.suiteRatePaise : p.deluxeRatePaise;
      const taxPaise = Math.round(ratePaise * nights * 0.12);
      const isInHouse = s.status === "IN_HOUSE";
      const isCheckedOut = s.status === "CHECKED_OUT";

      const resData = {
        propertyId: p.id,
        code,
        guestId: guestId(i % GUEST_TEMPLATES.length),
        status: s.status,
        source: s.source,
        checkInDate,
        checkOutDate,
        checkInAt: isInHouse || isCheckedOut ? at(checkInDate, 14) : null,
        checkOutAt: isCheckedOut ? at(checkOutDate, 11) : null,
        nights,
        adults: s.adults,
        children: s.children,
        ratePaise,
        taxPaise,
        advancePaise: s.advancePaise,
        holdExpiresAt: s.status === "ENQUIRY" ? at(checkInDate, 12) : null,
      };
      await prisma.reservation.upsert({ where: { id: rid }, create: { id: rid, ...resData }, update: resData });
    }

    // --- Allocations ------------------------------------------------------
    // Only reservations that hold a room; each occupied/checked-out/reserved
    // room is used by exactly one reservation, so no date-range overlap on the
    // `room_no_overlap` exclusion constraint. Delete-then-create is safe: the
    // property block only runs on a fresh (room-less) property.
    await prisma.roomAllocation.deleteMany({ where: { reservationId: { in: reservationIds } } });
    const allocations = RES_SPECS.map((s, i) => {
      if (!s.room || s.status === "ENQUIRY" || s.status === "CANCELLED") return null;
      return {
        propertyId: p.id,
        reservationId: reservationIds[i]!,
        roomId: roomId(s.room),
        startDate: day(s.ci),
        endDate: day(s.co),
      };
    }).filter((a): a is NonNullable<typeof a> => a !== null);
    if (allocations.length > 0) await prisma.roomAllocation.createMany({ data: allocations });
  }
}
