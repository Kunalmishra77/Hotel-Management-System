/**
 * Hauz Khas demo seed — the CLIENT's real portfolio at India-realistic scale.
 *
 * Woodpecker operates four small serviced-apartment blocks in Hauz Khas, New
 * Delhi (total 16 rooms). The generic multi-hotel demo (27/28/29) models large
 * hotels and inflates revenue to crores — wrong for a 16-room operation. This
 * seed replaces it with a right-sized picture: modest Delhi tariffs
 * (₹2,500–3,500/night), a few dozen bookings, monthly revenue in low lakhs, and
 * small pending dues — what these properties actually look like.
 *
 * Runs only under `SEED_DEMO=hauzkhas` (index.ts), which skips every other demo
 * inflator. Idempotent: fixed ids + upserts; RoomAllocation is delete-then-
 * create (avoids the `room_no_overlap` exclusion constraint on re-run); folio
 * lines + payments are append-only (createMany skipDuplicates, fixed ids).
 *
 * Money is integer paise; folio/payment amounts BigInt. Accommodation + all
 * on-premise services in Delhi → place-of-supply = Delhi, so GST is always
 * CGST+SGST (12% split 6%+6%), per business-rules.md §10.
 */
import type {
  PrismaClient,
  BookingSource,
  ReservationStatus,
  SettlementIntent,
  RoomStatus,
  PaymentMode,
  HousekeepingTaskType,
  HousekeepingStatus,
  MaintenanceCategory,
  MaintenanceStatus,
  MaintenancePriority,
} from "@prisma/client";
import { encryptString, keyedHash } from "../../src/lib/crypto/encryption";
import { normalizePhone } from "../../src/features/guests/domain/normalize";
import { gstinCheckDigit } from "../../src/features/properties/domain/gstin";
import {
  ORG_ID,
  PROP_A_ID,
  PROP_B_ID,
  SEED_CLOCK,
  USER_ACCOUNTS_ID,
  USER_MANAGER_ID,
  USER_OWNER_AB_ID,
  FLOOR_A_1_ID,
  FLOOR_A_2_ID,
} from "./fixtures";

// --- date helpers -----------------------------------------------------------
const NOW = new Date();
const TODAY = new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth(), NOW.getUTCDate()));
function day(n: number): Date {
  const d = new Date(TODAY);
  d.setUTCDate(d.getUTCDate() + n);
  return d;
}
function at(date: Date, hour: number): Date {
  return new Date(date.getTime() + hour * 3_600_000);
}
/** 12% accommodation GST, split CGST=SGST=6% (Delhi place-of-supply). */
function gstSplit(amountPaise: number): { cgst: number; sgst: number } {
  const half = Math.round(amountPaise * 0.06);
  return { cgst: half, sgst: half };
}
/** A valid Delhi (state 07) GSTIN: 07 + fixed PAN + entity + Z + check digit. */
function delhiGstin(entity: string): string {
  const first14 = `07AABCW1234F${entity}Z`;
  return first14 + gstinCheckDigit(first14);
}

const HKD30_ID = "prop_hkd30";
const HKD23_ID = "prop_hkd23";
const PLACE = "Delhi";

// ===========================================================================
// The four properties + their rooms (16 total)
// ===========================================================================
interface RoomCfg {
  id: string;
  number: string;
  floorId: string;
  catId: string;
  ratePaise: number;
}
interface CatCfg {
  id: string;
  name: string;
  ratePaise: number;
  maxAdults: number;
  maxChildren: number;
}
interface FloorCfg {
  id: string;
  name: string;
  sortOrder: number;
}
interface PropCfg {
  id: string;
  code: string;
  name: string;
  addressLine1: string;
  gstin: string;
  /** true ⇒ the row already exists (00-platform) and is retrofitted, not created. */
  existing: boolean;
  floors: FloorCfg[];
  cats: CatCfg[];
  rooms: RoomCfg[];
}

// D-1/17 — the flagship: 3 units × 3BHK = 9 rooms (6 attached-bath, 3 shared).
// Reuses PROP-A's existing rooms/floors (re-pointed to Hauz-Khas categories).
const HKD17_ATTACHED = "cat_hkd17_attached";
const HKD17_SHARED = "cat_hkd17_shared";
const d17Room = (n: string, floorId: string, catId: string, ratePaise: number): RoomCfg => ({
  id: `room_wmg_${n}`,
  number: n,
  floorId,
  catId,
  ratePaise,
});

const PROPS: PropCfg[] = [
  {
    id: PROP_A_ID,
    code: "HKD17",
    name: "Hauz Khas D-1/17",
    addressLine1: "D-1/17, Hauz Khas",
    gstin: delhiGstin("1"),
    existing: true,
    floors: [], // reuse PROP-A floors
    cats: [
      { id: HKD17_ATTACHED, name: "3BHK · Attached Bath", ratePaise: 350_000, maxAdults: 3, maxChildren: 2 },
      { id: HKD17_SHARED, name: "3BHK · Shared Bath", ratePaise: 250_000, maxAdults: 2, maxChildren: 1 },
    ],
    rooms: [
      d17Room("101", FLOOR_A_1_ID, HKD17_ATTACHED, 350_000),
      d17Room("102", FLOOR_A_1_ID, HKD17_ATTACHED, 350_000),
      d17Room("103", FLOOR_A_1_ID, HKD17_ATTACHED, 350_000),
      d17Room("104", FLOOR_A_1_ID, HKD17_ATTACHED, 350_000),
      d17Room("105", FLOOR_A_1_ID, HKD17_ATTACHED, 350_000),
      d17Room("201", FLOOR_A_2_ID, HKD17_ATTACHED, 350_000),
      d17Room("202", FLOOR_A_2_ID, HKD17_SHARED, 250_000),
      d17Room("203", FLOOR_A_2_ID, HKD17_SHARED, 250_000),
      d17Room("204", FLOOR_A_2_ID, HKD17_SHARED, 250_000),
    ],
  },
  {
    id: PROP_B_ID,
    code: "HKD3",
    name: "Hauz Khas D-1/3",
    addressLine1: "D-1/3, Hauz Khas",
    gstin: delhiGstin("2"),
    existing: true,
    floors: [{ id: "floor_hkd3_1", name: "1", sortOrder: 1 }],
    cats: [{ id: "cat_hkd3", name: "Serviced Room", ratePaise: 280_000, maxAdults: 2, maxChildren: 1 }],
    rooms: [
      { id: "room_hkd3_1", number: "101", floorId: "floor_hkd3_1", catId: "cat_hkd3", ratePaise: 280_000 },
      { id: "room_hkd3_2", number: "102", floorId: "floor_hkd3_1", catId: "cat_hkd3", ratePaise: 280_000 },
      { id: "room_hkd3_3", number: "103", floorId: "floor_hkd3_1", catId: "cat_hkd3", ratePaise: 280_000 },
    ],
  },
  {
    id: HKD30_ID,
    code: "HKD30",
    name: "Hauz Khas D-1/30",
    addressLine1: "D-1/30, Hauz Khas",
    gstin: delhiGstin("3"),
    existing: false,
    floors: [{ id: "floor_hkd30_1", name: "1", sortOrder: 1 }],
    cats: [{ id: "cat_hkd30", name: "2BHK Apartment", ratePaise: 320_000, maxAdults: 4, maxChildren: 2 }],
    rooms: [
      { id: "room_hkd30_1", number: "201", floorId: "floor_hkd30_1", catId: "cat_hkd30", ratePaise: 320_000 },
      { id: "room_hkd30_2", number: "202", floorId: "floor_hkd30_1", catId: "cat_hkd30", ratePaise: 320_000 },
    ],
  },
  {
    id: HKD23_ID,
    code: "HKD23",
    name: "Hauz Khas D-1/23",
    addressLine1: "D-1/23, Hauz Khas",
    gstin: delhiGstin("4"),
    existing: false,
    floors: [{ id: "floor_hkd23_1", name: "1", sortOrder: 1 }],
    cats: [{ id: "cat_hkd23", name: "2BHK Apartment", ratePaise: 300_000, maxAdults: 4, maxChildren: 2 }],
    rooms: [
      { id: "room_hkd23_1", number: "301", floorId: "floor_hkd23_1", catId: "cat_hkd23", ratePaise: 300_000 },
      { id: "room_hkd23_2", number: "302", floorId: "floor_hkd23_1", catId: "cat_hkd23", ratePaise: 300_000 },
    ],
  },
];

// ===========================================================================
// Guests (Delhi-NCR + metro travellers)
// ===========================================================================
const GUESTS: { fullName: string; city: string; state: string; company?: string }[] = [
  { fullName: "Ankit Bhardwaj", city: "New Delhi", state: "Delhi" },
  { fullName: "Sunita Rani", city: "Gurugram", state: "Haryana", company: "Genpact" },
  { fullName: "Rahul Malhotra", city: "Noida", state: "Uttar Pradesh" },
  { fullName: "Fatima Qureshi", city: "New Delhi", state: "Delhi" },
  { fullName: "Vivek Chandra", city: "Faridabad", state: "Haryana", company: "EXL Service" },
  { fullName: "Nandini Sen", city: "Kolkata", state: "West Bengal" },
  { fullName: "Harpreet Singh", city: "Chandigarh", state: "Chandigarh" },
  { fullName: "Meghna Kapoor", city: "New Delhi", state: "Delhi", company: "NDTV" },
  { fullName: "Arjun Nair", city: "Mumbai", state: "Maharashtra" },
  { fullName: "Pooja Aggarwal", city: "Ghaziabad", state: "Uttar Pradesh" },
  { fullName: "Sameer Joshi", city: "Pune", state: "Maharashtra" },
  { fullName: "Ritika Bansal", city: "New Delhi", state: "Delhi" },
  { fullName: "Imran Sheikh", city: "Lucknow", state: "Uttar Pradesh", company: "HCL Tech" },
  { fullName: "Deepika Rao", city: "Bengaluru", state: "Karnataka" },
  { fullName: "Kabir Ahluwalia", city: "New Delhi", state: "Delhi" },
  { fullName: "Shweta Menon", city: "Gurugram", state: "Haryana" },
  { fullName: "Tarun Khanna", city: "New Delhi", state: "Delhi", company: "Maruti Suzuki" },
  { fullName: "Aisha Siddiqui", city: "Hyderabad", state: "Telangana" },
  { fullName: "Rohan Dutta", city: "New Delhi", state: "Delhi" },
  { fullName: "Neelam Verma", city: "Jaipur", state: "Rajasthan" },
  { fullName: "Gaurav Sethi", city: "Noida", state: "Uttar Pradesh" },
  { fullName: "Priyanka Iyer", city: "Chennai", state: "Tamil Nadu", company: "Zoho" },
  { fullName: "Vikas Chauhan", city: "New Delhi", state: "Delhi" },
  { fullName: "Anjali Mehra", city: "Gurugram", state: "Haryana" },
];
const guestId = (i: number) => `hk_g_${String(i + 1).padStart(2, "0")}`;
const guestMobile = (i: number) => `98730${String(i + 1).padStart(5, "0")}`;

// Tier snapshots for the first dozen guests (VIP = visits≥5 or rev≥₹1,00,000).
const STATS: { visits: number; revenuePaise: bigint }[] = [
  { visits: 6, revenuePaise: 12_00_000n },
  { visits: 5, revenuePaise: 9_50_000n },
  { visits: 3, revenuePaise: 4_20_000n },
  { visits: 2, revenuePaise: 2_80_000n },
  { visits: 4, revenuePaise: 6_10_000n },
  { visits: 1, revenuePaise: 90_000n },
  { visits: 2, revenuePaise: 3_40_000n },
  { visits: 3, revenuePaise: 5_00_000n },
  { visits: 1, revenuePaise: 1_20_000n },
  { visits: 2, revenuePaise: 2_10_000n },
  { visits: 5, revenuePaise: 8_00_000n },
  { visits: 1, revenuePaise: 75_000n },
];

const SOURCES: BookingSource[] = [
  "DIRECT",
  "WEBSITE",
  "PHONE",
  "BOOKING_COM",
  "MAKEMYTRIP",
  "GOIBIBO",
  "AGODA",
  "AIRBNB",
  "CORPORATE",
];

// ===========================================================================
// Reservation plan — generated per room so allocations never overlap.
// ===========================================================================
interface ResSpec {
  propId: string;
  roomId: string | null;
  roomNumber: string | null;
  ratePaise: number;
  status: ReservationStatus;
  ci: number;
  co: number;
  adults: number;
  children: number;
  settlement: SettlementIntent;
  folio: boolean;
  pay: "full" | "partial" | null;
  food: boolean;
  payToday: boolean;
  advancePaise: number;
  roomStatus?: RoomStatus;
}

const specs: ResSpec[] = [];
// live room status: last (current-phase) reservation wins.
const roomStatusById = new Map<string, RoomStatus>();

for (const p of PROPS) {
  const nOcc = Math.ceil(p.rooms.length * 0.6);
  p.rooms.forEach((room, ri) => {
    // 1–2 past CHECKED_OUT stays this month (disjoint past windows).
    const histWindows: [number, number][] = ri % 2 === 0 ? [[-17, -14], [-12, -9]] : [[-15, -12]];
    histWindows.forEach(([ci, co], h) => {
      specs.push({
        propId: p.id,
        roomId: room.id,
        roomNumber: room.number,
        ratePaise: room.ratePaise,
        status: "CHECKED_OUT",
        ci,
        co,
        adults: 1 + ((ri + h) % 2),
        children: (ri + h) % 3 === 0 ? 1 : 0,
        settlement: "ALREADY_PAID",
        folio: true,
        pay: "full",
        food: h === 0,
        payToday: false,
        advancePaise: 0,
      });
    });

    if (ri < nOcc) {
      // Current in-house stay (serviced-apartment length: 4–9 nights).
      const ci = -(2 + (ri % 5));
      const co = 2 + (ri % 7);
      specs.push({
        propId: p.id,
        roomId: room.id,
        roomNumber: room.number,
        ratePaise: room.ratePaise,
        status: "IN_HOUSE",
        ci,
        co,
        adults: 1 + (ri % 2),
        children: ri % 3 === 0 ? 1 : 0,
        settlement: "PAY_AT_HOTEL",
        folio: true,
        pay: "partial",
        food: ri % 2 === 0,
        payToday: ri % 2 === 0,
        advancePaise: 150_000,
        roomStatus: "OCCUPIED",
      });
      roomStatusById.set(room.id, "OCCUPIED");
    } else {
      // Vacant now → an upcoming booking (one per property arrives today).
      const arriveToday = ri === nOcc;
      const ci = arriveToday ? 0 : 2 + (ri % 4);
      const co = ci + (3 + (ri % 4));
      specs.push({
        propId: p.id,
        roomId: room.id,
        roomNumber: room.number,
        ratePaise: room.ratePaise,
        status: "CONFIRMED",
        ci,
        co,
        adults: 2,
        children: ri % 2,
        settlement: ri % 2 === 0 ? "PAY_AT_HOTEL" : "UNPAID_ONLINE",
        folio: false,
        pay: null,
        food: false,
        payToday: false,
        advancePaise: ri % 2 === 0 ? 0 : 100_000,
        roomStatus: arriveToday ? "RESERVED" : "VACANT",
      });
      roomStatusById.set(room.id, arriveToday ? "RESERVED" : "VACANT");
    }
  });

  // Non-consuming reservations (no room, no folio): a cancellation, a no-show,
  // an open enquiry — so the funnel/cancellation metrics aren't empty.
  const rate = p.rooms[0]!.ratePaise;
  specs.push({ propId: p.id, roomId: null, roomNumber: null, ratePaise: rate, status: "CANCELLED", ci: 4, co: 7, adults: 2, children: 0, settlement: "PAY_AT_HOTEL", folio: false, pay: null, food: false, payToday: false, advancePaise: 0 });
  if (p.rooms.length >= 3)
    specs.push({ propId: p.id, roomId: null, roomNumber: null, ratePaise: rate, status: "NO_SHOW", ci: -1, co: 1, adults: 1, children: 0, settlement: "PAY_AT_HOTEL", folio: false, pay: null, food: false, payToday: false, advancePaise: 0 });
  specs.push({ propId: p.id, roomId: null, roomNumber: null, ratePaise: rate, status: "ENQUIRY", ci: 9, co: 12, adults: 2, children: 1, settlement: "PAY_AT_HOTEL", folio: false, pay: null, food: false, payToday: false, advancePaise: 0 });
}

// ===========================================================================
// Seed
// ===========================================================================
export async function seedDemoHauzKhas(prisma: PrismaClient): Promise<void> {
  // --- Properties ---------------------------------------------------------
  for (const p of PROPS) {
    const common = {
      name: p.name,
      code: p.code,
      addressLine1: p.addressLine1,
      city: "New Delhi",
      state: PLACE,
      pincode: "110016",
      gstin: p.gstin,
      isActive: true,
    };
    if (p.existing) {
      await prisma.property.update({ where: { id: p.id }, data: common });
    } else {
      await prisma.property.upsert({
        where: { id: p.id },
        create: {
          id: p.id,
          orgId: ORG_ID,
          ...common,
          timezone: "Asia/Kolkata",
          currentBusinessDate: SEED_CLOCK,
          nightAuditTime: "03:00",
          wifiSsid: `Woodpecker-${p.code}`,
          wifiPassword: "stay-well-2026",
          emergencyContact: "+91 11 4000 5000",
          checkInInstructions: "Serviced apartment — caretaker on call at the gate.",
          managementFeeBps: 1500,
        },
        update: common,
      });
    }

    // Floors
    for (const f of p.floors) {
      await prisma.floor.upsert({
        where: { id: f.id },
        create: { id: f.id, propertyId: p.id, name: f.name, sortOrder: f.sortOrder },
        update: { name: f.name, sortOrder: f.sortOrder },
      });
    }
    // Categories
    for (const c of p.cats) {
      await prisma.roomCategory.upsert({
        where: { id: c.id },
        create: {
          id: c.id,
          propertyId: p.id,
          name: c.name,
          baseRatePaise: c.ratePaise,
          hsnSac: "996311",
          gstBps: 1200,
          maxAdults: c.maxAdults,
          maxChildren: c.maxChildren,
        },
        update: { name: c.name, baseRatePaise: c.ratePaise, maxAdults: c.maxAdults, maxChildren: c.maxChildren },
      });
    }
    // Rooms
    for (const r of p.rooms) {
      const status = roomStatusById.get(r.id) ?? "VACANT";
      await prisma.room.upsert({
        where: { id: r.id },
        create: { id: r.id, propertyId: p.id, floorId: r.floorId, categoryId: r.catId, number: r.number, status, isActive: true },
        update: { floorId: r.floorId, categoryId: r.catId, number: r.number, status, isActive: true },
      });
    }
  }

  // PROP-A had 10 rooms (00/01); D-1/17 keeps 9. Retire the 10th and any old
  // demo rooms so the live room count matches the client's real inventory (16).
  const keptRoomIds = new Set(PROPS.flatMap((p) => p.rooms.map((r) => r.id)));
  await prisma.room.updateMany({
    where: { propertyId: { in: [PROP_A_ID, PROP_B_ID] }, id: { notIn: [...keptRoomIds] } },
    data: { isActive: false },
  });

  // --- Staff scope: managers/accounts/owner see all four Hauz Khas blocks --
  const allPropIds = PROPS.map((p) => p.id);
  for (const [userId, role] of [
    [USER_MANAGER_ID, "MANAGER"],
    [USER_ACCOUNTS_ID, "ACCOUNTS"],
    [USER_OWNER_AB_ID, "OWNER"],
  ] as const) {
    await prisma.roleAssignment.updateMany({ where: { userId, role }, data: { propertyIds: allPropIds } });
  }

  // --- Guests + tier snapshots --------------------------------------------
  for (let i = 0; i < GUESTS.length; i++) {
    const g = GUESTS[i]!;
    const mobile = guestMobile(i);
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
    await prisma.guest.upsert({ where: { id: guestId(i) }, create: { id: guestId(i), ...data }, update: data });
  }
  for (let i = 0; i < STATS.length; i++) {
    const st = STATS[i]!;
    const data = { visits: st.visits, totalRoomNights: st.visits * 3, totalRevenuePaise: st.revenuePaise, lastStayAt: at(day(-(4 + i * 4)), 11) };
    await prisma.guestStatsSnapshot.upsert({ where: { guestId: guestId(i) }, create: { guestId: guestId(i), ...data }, update: data });
  }

  // --- Reservations + folios + lines + payments ---------------------------
  const reservationIds: string[] = [];
  const folioLineRows: {
    id: string; folioId: string; type: "ROOM" | "FOOD"; description: string; quantity: number;
    unitPaise: number; amountPaise: bigint; taxRateBps: number; cgstPaise: number; sgstPaise: number;
    hsnSac: string; placeOfSupplyState: string; businessDate: Date;
  }[] = [];
  const paymentRows: { id: string; propertyId: string; folioId: string; mode: PaymentMode; amountPaise: bigint; reference: string; receivedAt: Date }[] = [];
  const modes: PaymentMode[] = ["CASH", "UPI", "CREDIT_CARD", "BANK_TRANSFER"];

  for (let i = 0; i < specs.length; i++) {
    const s = specs[i]!;
    const rid = `hk_r_${String(i + 1).padStart(3, "0")}`;
    reservationIds.push(rid);
    const code = `HK-${String(i + 1).padStart(4, "0")}`;
    const checkInDate = day(s.ci);
    const checkOutDate = day(s.co);
    const nights = Math.max(1, s.co - s.ci);
    const roomTotal = s.ratePaise * nights;
    const isCheckedOut = s.status === "CHECKED_OUT";
    const isInHouse = s.status === "IN_HOUSE";

    const resData = {
      propertyId: s.propId,
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
      ratePaise: s.ratePaise,
      taxPaise: Math.round(roomTotal * 0.12),
      advancePaise: s.advancePaise,
      holdExpiresAt: s.status === "ENQUIRY" ? at(checkInDate, 12) : null,
    };
    await prisma.reservation.upsert({ where: { id: rid }, create: { id: rid, ...resData }, update: resData });

    if (s.folio && s.roomId && s.roomNumber) {
      const folioId = `hk_fol_${String(i + 1).padStart(3, "0")}`;
      await prisma.folio.upsert({
        where: { id: folioId },
        create: { id: folioId, propertyId: s.propId, kind: "RESERVATION", reservationId: rid, isClosed: isCheckedOut },
        update: { isClosed: isCheckedOut },
      });

      const roomGst = gstSplit(roomTotal);
      folioLineRows.push({
        id: `hk_fl_${String(i + 1).padStart(3, "0")}_room`,
        folioId,
        type: "ROOM",
        description: `Room ${s.roomNumber} · ${nights} night(s)`,
        quantity: nights,
        unitPaise: s.ratePaise,
        amountPaise: BigInt(roomTotal),
        taxRateBps: 1200,
        cgstPaise: roomGst.cgst,
        sgstPaise: roomGst.sgst,
        hsnSac: "996311",
        placeOfSupplyState: PLACE,
        businessDate: checkInDate,
      });

      let foodTotal = 0;
      let foodGst = { cgst: 0, sgst: 0 };
      if (s.food) {
        foodTotal = 90_000; // ₹900 F&B — modest
        foodGst = gstSplit(foodTotal);
        folioLineRows.push({
          id: `hk_fl_${String(i + 1).padStart(3, "0")}_food`,
          folioId,
          type: "FOOD",
          description: "Kitchen — home-style meal",
          quantity: 1,
          unitPaise: foodTotal,
          amountPaise: BigInt(foodTotal),
          taxRateBps: 1200,
          cgstPaise: foodGst.cgst,
          sgstPaise: foodGst.sgst,
          hsnSac: "996331",
          placeOfSupplyState: PLACE,
          businessDate: checkInDate,
        });
      }

      if (s.pay) {
        const grand = roomTotal + roomGst.cgst + roomGst.sgst + foodTotal + foodGst.cgst + foodGst.sgst;
        const amount = s.pay === "full" ? grand : Math.max(80_000, Math.round(grand * 0.4));
        const receivedAt = s.payToday ? NOW : isCheckedOut ? at(checkOutDate, 11) : at(checkInDate, 15);
        paymentRows.push({
          id: `hk_pay_${String(i + 1).padStart(3, "0")}`,
          propertyId: s.propId,
          folioId,
          mode: modes[i % modes.length]!,
          amountPaise: BigInt(amount),
          reference: `RCPT-${code}`,
          receivedAt,
        });
      }
    }
  }

  await prisma.roomAllocation.deleteMany({ where: { reservationId: { in: reservationIds } } });
  const allocations = specs
    .map((s, i) => {
      if (!s.roomId || s.status === "CANCELLED" || s.status === "NO_SHOW" || s.status === "ENQUIRY") return null;
      return {
        propertyId: s.propId,
        reservationId: reservationIds[i]!,
        roomId: s.roomId,
        startDate: day(s.ci),
        endDate: day(s.co === s.ci ? s.ci + 1 : s.co),
      };
    })
    .filter((a): a is NonNullable<typeof a> => a !== null);
  await prisma.roomAllocation.createMany({ data: allocations });
  await prisma.folioLine.createMany({ data: folioLineRows, skipDuplicates: true });
  await prisma.payment.createMany({ data: paymentRows, skipDuplicates: true });

  // --- A little operational texture (flagship D-1/17) ---------------------
  const HK_TYPES: HousekeepingTaskType[] = ["CLEANING", "LINEN_CHANGE", "TOWEL_CHANGE", "INSPECTION"];
  const HK_STATUS: HousekeepingStatus[] = ["PENDING", "IN_PROGRESS", "DONE"];
  const d17Rooms = PROPS[0]!.rooms;
  for (let i = 0; i < d17Rooms.length; i++) {
    const id = `hk_task_${String(i + 1).padStart(2, "0")}`;
    const type = HK_TYPES[i % HK_TYPES.length]!;
    const status = HK_STATUS[i % HK_STATUS.length]!;
    const data = {
      propertyId: PROP_A_ID,
      roomId: d17Rooms[i]!.id,
      type,
      status,
      linenChanged: type === "LINEN_CHANGE" && status === "DONE",
      towelChanged: type === "TOWEL_CHANGE" && status === "DONE",
      complaintText: i === 3 ? "Geyser slow to heat." : null,
      serverStatusChangedAt: status === "DONE" ? at(TODAY, 9 + i) : null,
    };
    await prisma.housekeepingTask.upsert({ where: { id }, create: { id, ...data }, update: data });
  }

  const MJ_CATS: MaintenanceCategory[] = ["AC", "PLUMBING", "ELECTRICAL", "FURNITURE"];
  const MJ_STATUS: MaintenanceStatus[] = ["OPEN", "IN_PROGRESS", "CLOSED", "CLOSED"];
  const MJ_PRIO: MaintenancePriority[] = ["NORMAL", "HIGH", "LOW", "NORMAL"];
  const MJ_DESC = ["Split AC servicing", "Kitchen tap leak", "Corridor light flickering", "Sofa upholstery repair"];
  for (let i = 0; i < 4; i++) {
    const id = `hk_mj_${String(i + 1).padStart(2, "0")}`;
    const status = MJ_STATUS[i]!;
    const data = {
      propertyId: PROP_A_ID,
      roomId: d17Rooms[i]!.id,
      category: MJ_CATS[i]!,
      description: MJ_DESC[i]!,
      status,
      priority: MJ_PRIO[i]!,
      isPreventive: i === 0,
      scheduledFor: i === 0 ? day(6) : null,
      costPaise: status === "CLOSED" ? 40_000 + i * 15_000 : null,
      closedAt: status === "CLOSED" ? at(day(-(2 + i)), 16) : null,
    };
    await prisma.maintenanceJob.upsert({ where: { id }, create: { id, ...data }, update: data });
  }

  const REVIEWS: { rating: number; comment: string; sentiment: string; score: number }[] = [
    { rating: 5, comment: "Spotless apartment, great Hauz Khas location.", sentiment: "POSITIVE", score: 0.93 },
    { rating: 4, comment: "Comfortable 3BHK, caretaker very helpful.", sentiment: "POSITIVE", score: 0.66 },
    { rating: 5, comment: "Felt like home, quiet and clean.", sentiment: "POSITIVE", score: 0.9 },
    { rating: 3, comment: "Good stay but WiFi dropped at times.", sentiment: "NEUTRAL", score: -0.1 },
    { rating: 5, comment: "Excellent value for a serviced apartment.", sentiment: "POSITIVE", score: 0.92 },
    { rating: 4, comment: "Well maintained, close to the metro.", sentiment: "POSITIVE", score: 0.7 },
    { rating: 2, comment: "Shared bathroom wasn't ideal for us.", sentiment: "NEGATIVE", score: -0.5 },
    { rating: 5, comment: "Warm hospitality, will book again.", sentiment: "POSITIVE", score: 0.95 },
    { rating: 4, comment: "Spacious and safe for a family trip.", sentiment: "POSITIVE", score: 0.72 },
    { rating: 5, comment: "Perfect base for a Delhi work week.", sentiment: "POSITIVE", score: 0.9 },
  ];
  for (let i = 0; i < REVIEWS.length; i++) {
    const r = REVIEWS[i]!;
    const id = `hk_fb_${String(i + 1).padStart(2, "0")}`;
    const data = {
      propertyId: PROP_A_ID,
      guestId: guestId(i % GUESTS.length),
      rating: r.rating,
      comment: r.comment,
      sentiment: r.sentiment,
      sentimentScore: r.score,
      source: i % 2 === 0 ? "post-checkout" : "google",
      createdAt: at(day(-(i + 1)), 12),
    };
    await prisma.feedback.upsert({ where: { id }, create: { id, ...data }, update: data });
  }
}
