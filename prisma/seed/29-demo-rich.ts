/**
 * Rich demo seed — fills the flagship property (PROP-A "Woodpecker MG Road")
 * with a full, realistic operating picture so no page looks empty in a client
 * demo: a full room board, ~28 guests with tiers, ~54 reservations across every
 * status, folios with GST charges + payments (incl. money collected today),
 * housekeeping tasks, maintenance jobs, and guest feedback.
 *
 * Idempotent: fixed ids + upserts everywhere. RoomAllocation is delete-then-
 * create (freely deletable; avoids re-run overlap on the `room_no_overlap`
 * exclusion constraint). FolioLine + Payment are append-only (DB triggers block
 * UPDATE/DELETE), so they are createMany({ skipDuplicates }) with fixed ids.
 *
 * All dates are property-local `@db.Date`, computed relative to TODAY (UTC
 * midnight). Money is integer paise; folio/payment amounts are BigInt; GST is
 * 12% split CGST = SGST = 6% each (place-of-supply = property state, so always
 * CGST+SGST per business-rules.md §10).
 */
import type {
  PrismaClient,
  BookingSource,
  ReservationStatus,
  SettlementIntent,
  RoomStatus,
  HousekeepingTaskType,
  HousekeepingStatus,
  MaintenanceCategory,
  MaintenanceStatus,
  MaintenancePriority,
  PaymentMode,
} from "@prisma/client";
import { encryptString, keyedHash } from "../../src/lib/crypto/encryption";
import { normalizePhone } from "../../src/features/guests/domain/normalize";
import {
  FLOOR_A_1_ID,
  FLOOR_A_2_ID,
  ORG_ID,
  PROP_A_ID,
  ROOM_CATEGORY_A_DELUXE_ID,
  ROOM_CATEGORY_A_SUITE_ID,
  ROOMS_A_PREFIX,
} from "./fixtures";

// --- date helpers -----------------------------------------------------------
const NOW = new Date();
const TODAY = new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth(), NOW.getUTCDate()));
/** A property-local date, `n` days from today (negative = past). */
function day(n: number): Date {
  const d = new Date(TODAY);
  d.setUTCDate(d.getUTCDate() + n);
  return d;
}
/** A wall-clock instant on a given local date at `hour`. */
function at(date: Date, hour: number): Date {
  return new Date(date.getTime() + hour * 3_600_000);
}

// --- GST helper (12%, split into CGST=SGST=6%) ------------------------------
function gstSplit(amountPaise: number): { cgst: number; sgst: number } {
  const half = Math.round(amountPaise * 0.06); // 6% each, round half-up to paisa
  return { cgst: half, sgst: half };
}
/** Deluxe rooms are the 1xx line (₹4,000), Suites the 2xx line (₹7,000). */
function ratePaiseFor(roomNumber: string): number {
  return roomNumber.startsWith("1") ? 400_000 : 700_000;
}
const roomId = (n: string) => `${ROOMS_A_PREFIX}${n}`;

// ===========================================================================
// Guests
// ===========================================================================
const CITY_STATE: Record<string, string> = {
  Bengaluru: "Karnataka",
  Mumbai: "Maharashtra",
  Delhi: "Delhi",
  Pune: "Maharashtra",
  Hyderabad: "Telangana",
  Chennai: "Tamil Nadu",
};

interface DemoGuest {
  fullName: string;
  city: keyof typeof CITY_STATE;
  company?: string;
}
const GUESTS: DemoGuest[] = [
  { fullName: "Arjun Sharma", city: "Bengaluru" },
  { fullName: "Priya Nair", city: "Mumbai", company: "Infosys Ltd" },
  { fullName: "Rahul Verma", city: "Delhi" },
  { fullName: "Sneha Patil", city: "Pune" },
  { fullName: "Vikram Reddy", city: "Hyderabad", company: "Tech Mahindra" },
  { fullName: "Ananya Iyer", city: "Chennai" },
  { fullName: "Karthik Menon", city: "Bengaluru" },
  { fullName: "Divya Rao", city: "Mumbai" },
  { fullName: "Rohan Gupta", city: "Delhi", company: "Wipro" },
  { fullName: "Meera Joshi", city: "Pune" },
  { fullName: "Aditya Kumar", city: "Hyderabad" },
  { fullName: "Kavya Krishnan", city: "Chennai" },
  { fullName: "Siddharth Desai", city: "Bengaluru", company: "Flipkart" },
  { fullName: "Pooja Bhat", city: "Mumbai" },
  { fullName: "Nikhil Shetty", city: "Delhi" },
  { fullName: "Ritu Agarwal", city: "Pune" },
  { fullName: "Manish Pillai", city: "Hyderabad", company: "Zoho Corp" },
  { fullName: "Lakshmi Menon", city: "Chennai" },
  { fullName: "Suresh Babu", city: "Bengaluru" },
  { fullName: "Neha Kapoor", city: "Mumbai" },
  { fullName: "Amit Chauhan", city: "Delhi", company: "Paytm" },
  { fullName: "Deepa Nambiar", city: "Pune" },
  { fullName: "Varun Hegde", city: "Hyderabad" },
  { fullName: "Shreya Ghosh", city: "Chennai" },
  { fullName: "Rajesh Kulkarni", city: "Bengaluru" },
  { fullName: "Isha Malhotra", city: "Mumbai" },
  { fullName: "Gaurav Saxena", city: "Delhi" },
  { fullName: "Tara Krishnamurthy", city: "Chennai" },
];
const guestId = (i: number) => `demo_g_${String(i + 1).padStart(2, "0")}`;
/** Unique, valid-looking 10-digit Indian mobile per guest. */
const guestMobile = (i: number) => `98110${String(i + 1).padStart(5, "0")}`;

// Guest stats: guestId index → { visits, revenuePaise } so tiers show.
// VIP = visits ≥ 5 or revenue ≥ ₹1,00,000 (10,000,000 paise); Repeat = visits ≥ 2.
const STATS: { visits: number; revenuePaise: bigint }[] = [
  { visits: 8, revenuePaise: 25_000_000n }, // g01 VIP
  { visits: 6, revenuePaise: 15_000_000n }, // g02 VIP
  { visits: 5, revenuePaise: 8_000_000n }, //  g03 VIP (visits)
  { visits: 4, revenuePaise: 9_000_000n }, //  g04 Repeat
  { visits: 3, revenuePaise: 12_000_000n }, // g05 VIP (revenue)
  { visits: 2, revenuePaise: 4_000_000n }, //  g06 Repeat
  { visits: 2, revenuePaise: 3_500_000n }, //  g07 Repeat
  { visits: 3, revenuePaise: 6_500_000n }, //  g08 Repeat
  { visits: 7, revenuePaise: 20_000_000n }, // g09 VIP
  { visits: 1, revenuePaise: 1_800_000n }, //  g10 new
  { visits: 2, revenuePaise: 5_000_000n }, //  g11 Repeat
  { visits: 1, revenuePaise: 10_500_000n }, // g12 VIP (revenue)
];

// ===========================================================================
// Rooms to add (board becomes 25: 15 Deluxe + 10 Suite)
// ===========================================================================
const NEW_ROOMS: { number: string; floorId: string; categoryId: string }[] = [
  // 106–115 Deluxe on floor 1
  ...["106", "107", "108", "109", "110", "111", "112", "113", "114", "115"].map((n) => ({
    number: n,
    floorId: FLOOR_A_1_ID,
    categoryId: ROOM_CATEGORY_A_DELUXE_ID,
  })),
  // 206–210 Suite on floor 2
  ...["206", "207", "208", "209", "210"].map((n) => ({
    number: n,
    floorId: FLOOR_A_2_ID,
    categoryId: ROOM_CATEGORY_A_SUITE_ID,
  })),
];

// ===========================================================================
// Reservation plan
// ===========================================================================
const SOURCES: BookingSource[] = [
  "DIRECT",
  "WEBSITE",
  "WALK_IN",
  "BOOKING_COM",
  "AGODA",
  "MAKEMYTRIP",
  "GOIBIBO",
  "CORPORATE",
];

interface ResSpec {
  status: ReservationStatus;
  room: string | null;
  ci: number; // check-in offset (days from today)
  co: number; // check-out offset
  adults: number;
  children: number;
  settlement: SettlementIntent;
  folio: boolean;
  pay: "full" | "partial" | null;
  food: boolean;
  payToday: boolean;
  advancePaise: number;
  roomStatus?: RoomStatus; // status to force on the room (now)
}

const specs: ResSpec[] = [];

// --- Group A: 12 IN_HOUSE now (distinct rooms, OCCUPIED) --------------------
const A_ROOMS = ["101", "103", "105", "106", "107", "108", "109", "110", "111", "112", "113", "114"];
A_ROOMS.forEach((room, i) => {
  const span = 1 + (i % 4); // 1..4
  specs.push({
    status: "IN_HOUSE",
    room,
    ci: -span,
    co: span,
    adults: 1 + (i % 2),
    children: i % 3 === 0 ? 1 : 0,
    settlement: "PAY_AT_HOTEL",
    folio: true,
    pay: "partial",
    food: i % 2 === 0,
    payToday: i % 2 === 0, // 6 payments received today
    advancePaise: 200_000,
    roomStatus: "OCCUPIED",
  });
});

// --- Group B: 4 departing today (IN_HOUSE, checkout = today, OCCUPIED) ------
["115", "203", "205", "206"].forEach((room, i) => {
  specs.push({
    status: "IN_HOUSE",
    room,
    ci: -(2 + i),
    co: 0,
    adults: 2,
    children: i % 2,
    settlement: "PAY_AT_HOTEL",
    folio: true,
    pay: "partial",
    food: i % 2 === 0,
    payToday: false,
    advancePaise: 300_000,
    roomStatus: "OCCUPIED",
  });
});

// --- Group C: 5 arriving today (CONFIRMED, checkin = today, RESERVED) -------
["207", "208", "209", "210", "104"].forEach((room, i) => {
  specs.push({
    status: "CONFIRMED",
    room,
    ci: 0,
    co: i % 2 === 0 ? 2 : 3,
    adults: 1 + (i % 2),
    children: 0,
    settlement: i % 2 === 0 ? "PAY_AT_HOTEL" : "UNPAID_ONLINE",
    folio: false,
    pay: null,
    food: false,
    payToday: false,
    advancePaise: i % 2 === 0 ? 0 : 150_000,
    roomStatus: "RESERVED",
  });
});

// --- Group D: 5 future CONFIRMED (rooms free in the future window) ----------
["102", "201", "204", "205", "206"].forEach((room, i) => {
  const ci = 2 + i; // 2..6 days out
  specs.push({
    status: "CONFIRMED",
    room,
    ci,
    co: ci + 2,
    adults: 2,
    children: i % 2,
    settlement: i % 2 === 0 ? "PAY_AT_HOTEL" : "ALREADY_PAID",
    folio: false,
    pay: null,
    food: false,
    payToday: false,
    advancePaise: i % 2 === 0 ? 0 : 400_000,
  });
});

// --- Group E: 16 CHECKED_OUT history (distinct past weeks, no overlap) ------
const ALL_ROOMS = [
  "101", "102", "103", "104", "105", "106", "107", "108", "109", "110",
  "111", "112", "113", "114", "115", "201", "202", "203", "204", "205",
  "206", "207", "208", "209", "210",
];
for (let i = 0; i < 16; i++) {
  const nights = i % 3 === 0 ? 3 : 2;
  const ci = -(14 + i * 7); // one distinct week per stay
  specs.push({
    status: "CHECKED_OUT",
    room: ALL_ROOMS[i % ALL_ROOMS.length]!,
    ci,
    co: ci + nights,
    adults: 1 + (i % 2),
    children: i % 4 === 0 ? 1 : 0,
    settlement: "ALREADY_PAID",
    folio: true,
    pay: "full",
    food: i % 2 === 0,
    payToday: false,
    advancePaise: 0,
  });
}

// --- Group F: 5 CANCELLED + 3 NO_SHOW + 4 ENQUIRY (no allocation, no folio) -
for (let i = 0; i < 5; i++)
  specs.push({ status: "CANCELLED", room: null, ci: 3 + i, co: 5 + i, adults: 2, children: 0, settlement: "PAY_AT_HOTEL", folio: false, pay: null, food: false, payToday: false, advancePaise: 0 });
for (let i = 0; i < 3; i++)
  specs.push({ status: "NO_SHOW", room: null, ci: -1 - i, co: 1 - i, adults: 1, children: 0, settlement: "PAY_AT_HOTEL", folio: false, pay: null, food: false, payToday: false, advancePaise: 0 });
for (let i = 0; i < 4; i++)
  specs.push({ status: "ENQUIRY", room: null, ci: 10 + i, co: 12 + i, adults: 2, children: i % 2, settlement: "PAY_AT_HOTEL", folio: false, pay: null, food: false, payToday: false, advancePaise: 0 });

// ===========================================================================
// Seed
// ===========================================================================
export async function seedDemoRich(prisma: PrismaClient): Promise<void> {
  // --- Rooms --------------------------------------------------------------
  // Force the room's live status from any reservation that occupies/reserves it.
  const roomStatusOverride = new Map<string, RoomStatus>();
  for (const s of specs) {
    if (s.room && s.roomStatus) roomStatusOverride.set(s.room, s.roomStatus);
  }
  for (const r of NEW_ROOMS) {
    const id = roomId(r.number);
    const status: RoomStatus = roomStatusOverride.get(r.number) ?? "VACANT";
    await prisma.room.upsert({
      where: { id },
      create: {
        id,
        propertyId: PROP_A_ID,
        floorId: r.floorId,
        categoryId: r.categoryId,
        number: r.number,
        status,
        isActive: true,
      },
      update: { status, isActive: true },
    });
  }
  // Existing rooms that a reservation now occupies/reserves (101/103/104/105/203/205).
  for (const [number, status] of roomStatusOverride) {
    if (NEW_ROOMS.some((r) => r.number === number)) continue;
    await prisma.room.updateMany({ where: { id: roomId(number) }, data: { status } });
  }

  // --- Guests -------------------------------------------------------------
  for (let i = 0; i < GUESTS.length; i++) {
    const g = GUESTS[i]!;
    const id = guestId(i);
    const mobile = guestMobile(i);
    const data = {
      orgId: ORG_ID,
      fullName: g.fullName,
      mobile: encryptString(mobile),
      mobileHash: keyedHash(normalizePhone(mobile) ?? mobile),
      city: g.city,
      state: CITY_STATE[g.city],
      companyName: g.company ?? null,
      deletedAt: null,
      mergedIntoId: null,
    };
    await prisma.guest.upsert({ where: { id }, create: { id, ...data }, update: data });
  }

  // --- Guest stats snapshots (tiers) --------------------------------------
  for (let i = 0; i < STATS.length; i++) {
    const st = STATS[i]!;
    const data = {
      visits: st.visits,
      totalRoomNights: st.visits * 2,
      totalRevenuePaise: st.revenuePaise,
      lastStayAt: at(day(-(3 + i * 5)), 11),
    };
    await prisma.guestStatsSnapshot.upsert({
      where: { guestId: guestId(i) },
      create: { guestId: guestId(i), ...data },
      update: data,
    });
  }

  // --- Reservations + allocations + folios + lines + payments -------------
  const reservationIds: string[] = [];
  const folioLineRows: {
    id: string;
    folioId: string;
    type: "ROOM" | "FOOD";
    description: string;
    quantity: number;
    unitPaise: number;
    amountPaise: bigint;
    taxRateBps: number;
    cgstPaise: number;
    sgstPaise: number;
    hsnSac: string;
    placeOfSupplyState: string;
    businessDate: Date;
  }[] = [];
  const paymentRows: {
    id: string;
    propertyId: string;
    folioId: string;
    mode: PaymentMode;
    amountPaise: bigint;
    reference: string;
    receivedAt: Date;
  }[] = [];

  for (let i = 0; i < specs.length; i++) {
    const s = specs[i]!;
    const rid = `demo_r_${String(i + 1).padStart(2, "0")}`;
    reservationIds.push(rid);
    const code = `RSV-${String(i + 1).padStart(4, "0")}`;
    const checkInDate = day(s.ci);
    const checkOutDate = day(s.co);
    const nights = Math.max(1, s.co - s.ci);
    const rate = s.room ? ratePaiseFor(s.room) : 400_000;
    const roomTotal = rate * nights;
    const taxTotal = Math.round(roomTotal * 0.12);
    const isCheckedOut = s.status === "CHECKED_OUT";
    const isInHouse = s.status === "IN_HOUSE";

    const resData = {
      propertyId: PROP_A_ID,
      code,
      guestId: guestId(i % GUESTS.length),
      status: s.status,
      source: SOURCES[i % SOURCES.length]!,
      settlementIntent: s.settlement,
      checkInDate,
      checkOutDate,
      checkInAt: isInHouse || isCheckedOut ? at(checkInDate, 14) : null,
      checkOutAt: isCheckedOut ? at(checkOutDate, 11) : null,
      nights,
      adults: s.adults,
      children: s.children,
      ratePaise: rate,
      taxPaise: taxTotal,
      advancePaise: s.advancePaise,
      holdExpiresAt: s.status === "ENQUIRY" ? at(checkInDate, 12) : null,
    };
    await prisma.reservation.upsert({ where: { id: rid }, create: { id: rid, ...resData }, update: resData });

    // Folio + charges + payment for stays that have occupied a room.
    if (s.folio && s.room) {
      const folioId = `demo_fol_${String(i + 1).padStart(2, "0")}`;
      await prisma.folio.upsert({
        where: { id: folioId },
        create: { id: folioId, propertyId: PROP_A_ID, kind: "RESERVATION", reservationId: rid, isClosed: isCheckedOut },
        update: { isClosed: isCheckedOut },
      });

      const roomGst = gstSplit(roomTotal);
      folioLineRows.push({
        id: `demo_fl_${String(i + 1).padStart(2, "0")}_room`,
        folioId,
        type: "ROOM",
        description: `Room ${s.room} · ${nights} night(s)`,
        quantity: nights,
        unitPaise: rate,
        amountPaise: BigInt(roomTotal),
        taxRateBps: 1200,
        cgstPaise: roomGst.cgst,
        sgstPaise: roomGst.sgst,
        hsnSac: "996311",
        placeOfSupplyState: "Karnataka",
        businessDate: checkInDate,
      });

      let foodTotal = 0;
      let foodGst = { cgst: 0, sgst: 0 };
      if (s.food) {
        foodTotal = 150_000; // ₹1,500 F&B
        foodGst = gstSplit(foodTotal);
        folioLineRows.push({
          id: `demo_fl_${String(i + 1).padStart(2, "0")}_food`,
          folioId,
          type: "FOOD",
          description: "Restaurant — dinner",
          quantity: 1,
          unitPaise: foodTotal,
          amountPaise: BigInt(foodTotal),
          taxRateBps: 1200,
          cgstPaise: foodGst.cgst,
          sgstPaise: foodGst.sgst,
          hsnSac: "996331",
          placeOfSupplyState: "Karnataka",
          businessDate: checkInDate,
        });
      }

      if (s.pay) {
        const grand = roomTotal + roomGst.cgst + roomGst.sgst + foodTotal + foodGst.cgst + foodGst.sgst;
        const amount = s.pay === "full" ? grand : Math.max(100_000, Math.round(grand * 0.4));
        const receivedAt = s.payToday
          ? NOW
          : isCheckedOut
            ? at(checkOutDate, 11)
            : at(checkInDate, 15);
        const modes: PaymentMode[] = ["CASH", "UPI", "CREDIT_CARD", "BANK_TRANSFER"];
        paymentRows.push({
          id: `demo_pay_${String(i + 1).padStart(2, "0")}`,
          propertyId: PROP_A_ID,
          folioId,
          mode: modes[i % modes.length]!,
          amountPaise: BigInt(amount),
          reference: `RCPT-${code}`,
          receivedAt,
        });
      }
    }
  }

  // Allocations: delete-then-create (freely deletable; avoids re-run overlap).
  await prisma.roomAllocation.deleteMany({ where: { reservationId: { in: reservationIds } } });
  const allocations = specs
    .map((s, i) => {
      if (!s.room || s.status === "CANCELLED" || s.status === "NO_SHOW" || s.status === "ENQUIRY") return null;
      return {
        propertyId: PROP_A_ID,
        reservationId: reservationIds[i]!,
        roomId: roomId(s.room),
        startDate: day(s.ci),
        endDate: day(s.co === s.ci ? s.ci + 1 : s.co),
      };
    })
    .filter((a): a is NonNullable<typeof a> => a !== null);
  await prisma.roomAllocation.createMany({ data: allocations });

  // Append-only inserts (triggers block update/delete): idempotent via skipDuplicates.
  await prisma.folioLine.createMany({ data: folioLineRows, skipDuplicates: true });
  await prisma.payment.createMany({ data: paymentRows, skipDuplicates: true });

  // --- Housekeeping tasks (14) --------------------------------------------
  const HK_TYPES: HousekeepingTaskType[] = ["CLEANING", "LINEN_CHANGE", "TOWEL_CHANGE", "INSPECTION"];
  const HK_STATUS: HousekeepingStatus[] = ["PENDING", "IN_PROGRESS", "DONE"];
  const HK_ROOMS = ["101", "103", "105", "106", "108", "110", "112", "115", "203", "205", "206", "207", "209", "104"];
  for (let i = 0; i < HK_ROOMS.length; i++) {
    const id = `demo_hk_${String(i + 1).padStart(2, "0")}`;
    const type = HK_TYPES[i % HK_TYPES.length]!;
    const status = HK_STATUS[i % HK_STATUS.length]!;
    const complaint =
      i === 2 ? "Guest reports AC not cooling well." : i === 6 ? "Bathroom drain slow." : i === 11 ? "Extra towels requested." : null;
    const data = {
      propertyId: PROP_A_ID,
      roomId: roomId(HK_ROOMS[i]!),
      type,
      status,
      linenChanged: type === "LINEN_CHANGE" && status === "DONE",
      towelChanged: type === "TOWEL_CHANGE" && status === "DONE",
      complaintText: complaint,
      serverStatusChangedAt: status === "DONE" ? at(TODAY, 9 + (i % 6)) : null,
    };
    await prisma.housekeepingTask.upsert({ where: { id }, create: { id, ...data }, update: data });
  }

  // --- Maintenance jobs (8) -----------------------------------------------
  const MJ_CATS: MaintenanceCategory[] = ["AC", "ELECTRICAL", "PLUMBING", "FURNITURE", "PAINTING", "PEST_CONTROL", "OTHER", "AC"];
  const MJ_STATUS: MaintenanceStatus[] = ["OPEN", "IN_PROGRESS", "CLOSED", "OPEN", "CLOSED", "IN_PROGRESS", "CLOSED", "OPEN"];
  const MJ_PRIO: MaintenancePriority[] = ["NORMAL", "HIGH", "LOW", "NORMAL", "URGENT", "HIGH", "NORMAL", "LOW"];
  const MJ_ROOMS: (string | null)[] = ["202", "108", "205", "112", null, "101", "203", "210"];
  const MJ_DESC = [
    "Split AC servicing — low cooling",
    "Flickering corridor light — replace ballast",
    "Leaking tap in bathroom",
    "Wardrobe hinge loose",
    "Repaint lobby wall",
    "Monthly pest control treatment",
    "Geyser thermostat replacement",
    "Balcony door alignment",
  ];
  for (let i = 0; i < 8; i++) {
    const id = `demo_mj_${String(i + 1).padStart(2, "0")}`;
    const status = MJ_STATUS[i]!;
    const isPreventive = i === 4 || i === 5; // repaint + pest control are scheduled
    const data = {
      propertyId: PROP_A_ID,
      roomId: MJ_ROOMS[i] ? roomId(MJ_ROOMS[i]!) : null,
      category: MJ_CATS[i]!,
      description: MJ_DESC[i]!,
      status,
      priority: MJ_PRIO[i]!,
      isPreventive,
      scheduledFor: isPreventive ? day(5) : null,
      costPaise: status === "CLOSED" ? 50_000 + i * 25_000 : null,
      closedAt: status === "CLOSED" ? at(day(-(1 + i)), 16) : null,
    };
    await prisma.maintenanceJob.upsert({ where: { id }, create: { id, ...data }, update: data });
  }

  // --- Feedback (24; mostly positive) -------------------------------------
  const REVIEWS: { rating: number; comment: string; sentiment: string; score: number; source: string }[] = [
    { rating: 5, comment: "Fantastic stay, spotless rooms and warm staff.", sentiment: "POSITIVE", score: 0.95, source: "post-checkout" },
    { rating: 5, comment: "Great location near MG Road, will return.", sentiment: "POSITIVE", score: 0.9, source: "google" },
    { rating: 4, comment: "Comfortable suite, breakfast could be better.", sentiment: "POSITIVE", score: 0.6, source: "post-checkout" },
    { rating: 5, comment: "Excellent service at the front desk.", sentiment: "POSITIVE", score: 0.92, source: "google" },
    { rating: 3, comment: "Room was fine but check-in took a while.", sentiment: "NEUTRAL", score: 0.1, source: "post-checkout" },
    { rating: 5, comment: "Loved the housekeeping, very attentive.", sentiment: "POSITIVE", score: 0.88, source: "google" },
    { rating: 2, comment: "AC in my room was noisy at night.", sentiment: "NEGATIVE", score: -0.6, source: "post-checkout" },
    { rating: 4, comment: "Good value for money, clean and safe.", sentiment: "POSITIVE", score: 0.7, source: "google" },
    { rating: 5, comment: "The suite was spacious and well maintained.", sentiment: "POSITIVE", score: 0.9, source: "post-checkout" },
    { rating: 4, comment: "Pleasant stay, friendly staff.", sentiment: "POSITIVE", score: 0.65, source: "google" },
    { rating: 5, comment: "Best serviced apartment in Bengaluru!", sentiment: "POSITIVE", score: 0.97, source: "post-checkout" },
    { rating: 3, comment: "Average experience, nothing special.", sentiment: "NEUTRAL", score: 0.0, source: "google" },
    { rating: 5, comment: "Very hygienic and quiet, perfect for work.", sentiment: "POSITIVE", score: 0.9, source: "post-checkout" },
    { rating: 4, comment: "Nice rooms, quick room service.", sentiment: "POSITIVE", score: 0.68, source: "google" },
    { rating: 1, comment: "Booking mix-up at arrival, disappointing.", sentiment: "NEGATIVE", score: -0.85, source: "post-checkout" },
    { rating: 5, comment: "Wonderful hospitality, felt at home.", sentiment: "POSITIVE", score: 0.94, source: "google" },
    { rating: 4, comment: "Clean, comfortable and well located.", sentiment: "POSITIVE", score: 0.66, source: "post-checkout" },
    { rating: 5, comment: "Staff went above and beyond, thank you.", sentiment: "POSITIVE", score: 0.96, source: "google" },
    { rating: 3, comment: "WiFi was patchy in my room.", sentiment: "NEUTRAL", score: -0.15, source: "post-checkout" },
    { rating: 5, comment: "Amazing value, highly recommend.", sentiment: "POSITIVE", score: 0.93, source: "google" },
    { rating: 4, comment: "Comfortable bed and good breakfast.", sentiment: "POSITIVE", score: 0.7, source: "post-checkout" },
    { rating: 2, comment: "Housekeeping missed my room one day.", sentiment: "NEGATIVE", score: -0.5, source: "google" },
    { rating: 5, comment: "Impeccable rooms, will book again.", sentiment: "POSITIVE", score: 0.95, source: "post-checkout" },
    { rating: 4, comment: "Smooth check-out, courteous team.", sentiment: "POSITIVE", score: 0.72, source: "google" },
  ];
  for (let i = 0; i < REVIEWS.length; i++) {
    const r = REVIEWS[i]!;
    const id = `demo_fb_${String(i + 1).padStart(2, "0")}`;
    const data = {
      propertyId: PROP_A_ID,
      guestId: guestId(i % GUESTS.length),
      rating: r.rating,
      comment: r.comment,
      sentiment: r.sentiment,
      sentimentScore: r.score,
      source: r.source,
      createdAt: at(day(-(i + 1)), 12), // spread over the last ~24 days
    };
    await prisma.feedback.upsert({ where: { id }, create: { id, ...data }, update: data });
  }
}
