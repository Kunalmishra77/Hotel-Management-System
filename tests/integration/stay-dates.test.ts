/**
 * Stay-date rules (client, 15 Nov 2026):
 *  1. A check-out nobody pressed is never billed or extended by the night audit;
 *     pressing it late bills to the BOOKED date unless staff say the guest
 *     really stayed on (Gabrielle: booked 30→31 Oct, billed a 2nd night).
 *  2. An in-house guest leaving earlier can have the check-out moved now — the
 *     room frees from that date and the unused nights come off the bill.
 */
import { vi } from "vitest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient } from "@/lib/db/client";
import type { SessionClaims } from "@/lib/auth/claims";

const h = vi.hoisted(() => ({ user: null as SessionClaims | null }));
vi.mock("@/lib/auth", () => ({
  requireUser: async () => {
    if (!h.user) throw new Error("no acting user set");
    return h.user;
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

import { PROP_A_ID, GUEST_MEHTA_ID, USER_ADMIN_ID } from "../../prisma/seed/fixtures";
import { assembleClaims } from "@/lib/auth/claims";
import { checkOut } from "@/features/reservations/lifecycle-actions";
import { shortenStay } from "@/features/reservations/shorten-actions";
import { postRoomCharges } from "@/features/billing/night-audit";
import { changeExtensionSource } from "@/features/reservations/extension-actions";
import { findRoomsForDates } from "@/features/reservations/room-finder";

const prisma = createPrismaClient();
const DAY = 86_400_000;
const today = new Date(`${new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" })}T00:00:00Z`);
const d = (offset: number) => new Date(today.getTime() + offset * DAY);
const ymd = (x: Date) => x.toISOString().slice(0, 10);
const RATE = 250_000;
let roomSeq = 0;
const createdRooms: string[] = [];
// Its own room category, so the rooms this suite creates never change the seed
// categories' room counts that other suites assert on.
const TEST_CATEGORY_ID = "cat_test_stay_dates";

/** An IN_HOUSE stay on its own fresh room, every booked night billed (as check-in does). */
async function inHouseStay(fromOffset: number, toOffset: number) {
  const tag = `${Date.now().toString(36)}${roomSeq++}`;
  const room = await prisma.room.create({ data: { propertyId: PROP_A_ID, categoryId: TEST_CATEGORY_ID, number: `T${tag}`.slice(0, 12), status: "OCCUPIED" } });
  createdRooms.push(room.id);
  const checkInDate = d(fromOffset);
  const checkOutDate = d(toOffset);
  const r = await prisma.reservation.create({
    data: {
      code: `BK-SD${tag.toUpperCase()}`.slice(0, 16), propertyId: PROP_A_ID, guestId: GUEST_MEHTA_ID, source: "DIRECT", status: "IN_HOUSE",
      checkInDate, checkOutDate, nights: toOffset - fromOffset, adults: 1, ratePaise: RATE, checkInAt: checkInDate,
      allocations: { create: { propertyId: PROP_A_ID, roomId: room.id, startDate: checkInDate, endDate: checkOutDate } },
    },
  });
  const folio = await prisma.folio.create({ data: { propertyId: PROP_A_ID, reservationId: r.id } });
  for (let o = fromOffset; o < toOffset; o++) {
    await prisma.folioLine.create({
      data: {
        folioId: folio.id, type: "ROOM", description: "Room charge", quantity: 1, unitPaise: RATE, amountPaise: BigInt(RATE),
        taxRateBps: 500, cgstPaise: 6_250, sgstPaise: 6_250, igstPaise: 0, hsnSac: "996311", placeOfSupplyState: "MH", businessDate: d(o),
      },
    });
  }
  // Fully paid, so check-out isn't blocked by the balance gate.
  await prisma.payment.create({ data: { folioId: folio.id, propertyId: PROP_A_ID, mode: "CREDIT_CARD", amountPaise: BigInt((RATE + 12_500) * (toOffset - fromOffset)) } });
  return { id: r.id, folioId: folio.id, roomId: room.id };
}

const activeRoomNights = async (folioId: string) => {
  const lines = await prisma.folioLine.findMany({ where: { folioId }, select: { id: true, type: true, businessDate: true, reversalOfId: true } });
  const reversed = new Set(lines.filter((l) => l.type === "REVERSAL").map((l) => l.reversalOfId));
  return lines.filter((l) => l.type === "ROOM" && !reversed.has(l.id)).map((l) => ymd(l.businessDate)).sort();
};

beforeAll(async () => {
  await prisma.roomCategory.upsert({
    where: { id: TEST_CATEGORY_ID },
    update: {},
    create: { id: TEST_CATEGORY_ID, propertyId: PROP_A_ID, name: "Test — stay dates", baseRatePaise: RATE, gstBps: 500 },
  });
  const c = await assembleClaims(prisma, USER_ADMIN_ID);
  if (!c) throw new Error("no claims");
  h.user = { ...c, activePropertyId: PROP_A_ID };
});
afterAll(async () => {
  // Folio rows are append-only, so the test rooms stay — but deactivated, so
  // room counts / boards / occupancy in other suites aren't polluted.
  if (createdRooms.length) await prisma.room.updateMany({ where: { id: { in: createdRooms } }, data: { isActive: false, status: "VACANT" } });
  await prisma.$disconnect();
});

describe("overdue check-out (Gabrielle)", () => {
  it("night audit neither bills nor extends a stay whose check-out has passed", async () => {
    const s = await inHouseStay(-2, -1); // booked 1 night, check-out was yesterday
    await postRoomCharges(PROP_A_ID, d(-1)); // the audit closing yesterday
    const r = await prisma.reservation.findUniqueOrThrow({ where: { id: s.id }, include: { allocations: true } });
    expect(ymd(r.checkOutDate)).toBe(ymd(d(-1)));
    expect(r.allocations[0] && ymd(r.allocations[0].endDate)).toBe(ymd(d(-1)));
    expect(await activeRoomNights(s.folioId)).toEqual([ymd(d(-2))]);
  });

  it("pressing check-out late bills to the booked date by default", async () => {
    const s = await inHouseStay(-3, -1);
    const res = await checkOut({ reservationId: s.id });
    expect(res.ok, JSON.stringify(res)).toBe(true);
    expect(await activeRoomNights(s.folioId)).toEqual([ymd(d(-3)), ymd(d(-2))]);
    const r = await prisma.reservation.findUniqueOrThrow({ where: { id: s.id } });
    expect(r.status).toBe("CHECKED_OUT");
    expect(ymd(r.checkOutDate)).toBe(ymd(d(-1)));
  });

  it("'stayed till today' bills the extra night(s) through today", async () => {
    const s = await inHouseStay(-3, -1);
    const res = await checkOut({ reservationId: s.id, stayedLate: true, defer: true });
    expect(res.ok, JSON.stringify(res)).toBe(true);
    expect(await activeRoomNights(s.folioId)).toEqual([ymd(d(-3)), ymd(d(-2)), ymd(d(-1))]);
  });
});

describe("leaving earlier (shorten an in-house stay)", () => {
  it("moves the check-out, frees the room from that date and reverses the unused nights", async () => {
    const s = await inHouseStay(-1, 9); // a 10-night stay that started yesterday
    const res = await shortenStay({ reservationId: s.id, newCheckOutDate: ymd(d(4)) });
    expect(res.ok, JSON.stringify(res)).toBe(true);
    if (res.ok) expect(res.data.reversedNights).toBe(5);
    const r = await prisma.reservation.findUniqueOrThrow({ where: { id: s.id }, include: { allocations: true } });
    expect(r.status).toBe("IN_HOUSE");
    expect(ymd(r.checkOutDate)).toBe(ymd(d(4)));
    expect(r.nights).toBe(5);
    expect(r.allocations.map((a) => ymd(a.endDate))).toEqual([ymd(d(4))]);
    const nights = await activeRoomNights(s.folioId);
    expect(nights).toEqual([-1, 0, 1, 2, 3].map((o) => ymd(d(o))));
  });

  it("refuses a date that isn't earlier, or is in the past", async () => {
    const s = await inHouseStay(-1, 5);
    const later = await shortenStay({ reservationId: s.id, newCheckOutDate: ymd(d(6)) });
    expect(later.ok).toBe(false);
    const past = await shortenStay({ reservationId: s.id, newCheckOutDate: ymd(d(-1)) });
    expect(past.ok).toBe(false);
  });
});

describe("early departure on a prepaid stay (Archana, Airbnb, 16 Nov 2026)", () => {
  const balanceOf = async (folioId: string) => {
    const lines = await prisma.folioLine.findMany({ where: { folioId }, select: { amountPaise: true, cgstPaise: true, sgstPaise: true, igstPaise: true } });
    const pays = await prisma.payment.findMany({ where: { folioId }, select: { amountPaise: true, isRefund: true } });
    let b = 0n;
    for (const l of lines) b += BigInt(l.amountPaise) + BigInt(l.cgstPaise + l.sgstPaise + l.igstPaise);
    for (const p of pays) b += p.isRefund ? p.amountPaise : -p.amountPaise;
    return Number(b);
  };

  it("'refund' bills only the nights stayed and leaves the prepaid excess as a credit", async () => {
    const s = await inHouseStay(-1, 5); // 6 nights prepaid in full; leaving today after 1 night
    const res = await checkOut({ reservationId: s.id, unusedNights: "refund" });
    expect(res.ok, JSON.stringify(res)).toBe(true);
    expect(await activeRoomNights(s.folioId)).toEqual([ymd(d(-1))]);
    expect(await balanceOf(s.folioId)).toBe(-5 * (RATE + 12_500));
  });

  it("'retain' keeps the prepaid money as a non-refundable early-departure charge — balance ₹0, room nights still reversed", async () => {
    const s = await inHouseStay(-1, 5);
    const res = await checkOut({ reservationId: s.id, unusedNights: "retain" });
    expect(res.ok, JSON.stringify(res)).toBe(true);
    expect(await activeRoomNights(s.folioId)).toEqual([ymd(d(-1))]);
    expect(await balanceOf(s.folioId)).toBe(0);
    const charge = await prisma.folioLine.findFirst({ where: { folioId: s.folioId, type: "MISC", description: { startsWith: "Early departure charge" } } });
    expect(charge).not.toBeNull();
    expect(Number(charge!.amountPaise) + charge!.cgstPaise + charge!.sgstPaise).toBe(5 * (RATE + 12_500));
    const r = await prisma.reservation.findUniqueOrThrow({ where: { id: s.id }, include: { allocations: true } });
    expect(r.allocations.map((a) => ymd(a.endDate))).toEqual([ymd(d(0))]); // room free from today
  });
});

describe("an extension's channel can be corrected (Anand Agarwal, 17 Nov 2026)", () => {
  it("changes only that extension's source", async () => {
    const s = await inHouseStay(-1, 1);
    await prisma.stayExtension.create({ data: { propertyId: PROP_A_ID, reservationId: s.id, fromDate: d(0), toDate: d(1), source: "MAKEMYTRIP", ratePaise: RATE } });
    const res = await changeExtensionSource({ reservationId: s.id, fromDate: ymd(d(0)), source: "DIRECT" });
    expect(res.ok, JSON.stringify(res)).toBe(true);
    const ext = await prisma.stayExtension.findMany({ where: { reservationId: s.id } });
    expect(ext.map((e) => e.source)).toEqual(["DIRECT"]);
    const missing = await changeExtensionSource({ reservationId: s.id, fromDate: ymd(d(5)), source: "DIRECT" });
    expect(missing.ok).toBe(false);
  });
});

describe("Rooms → Find a room (client, 20 Nov 2026)", () => {
  it("lists a room free for every night as whole, and a partly-booked room with its free and taken nights", async () => {
    // Far-future window so no other suite's bookings overlap. inHouseStay() makes a fresh
    // room booked [600, 603); a second fresh room stays empty.
    const busy = await inHouseStay(600, 603);
    const room = (await prisma.reservation.findUniqueOrThrow({ where: { id: busy.id }, include: { allocations: true } })).allocations[0]!.roomId;
    const freeRoom = await prisma.room.create({ data: { propertyId: PROP_A_ID, categoryId: TEST_CATEGORY_ID, number: `F${Date.now().toString(36)}`.slice(0, 12) } });
    createdRooms.push(freeRoom.id);

    const res = await findRoomsForDates(h.user!, { from: ymd(d(598)), to: ymd(d(606)), propertyIds: [PROP_A_ID] });
    const hotel = res.hotels.find((x) => x.propertyId === PROP_A_ID)!;
    expect(res.nights).toBe(8);
    const whole = hotel.whole.find((r) => r.id === freeRoom.id);
    expect(whole).toBeDefined();
    expect(whole!.estimatePaise).toBe(8 * (RATE + 12_500)); // ₹2,500 room type + 5% GST × 8
    const part = hotel.partial.find((r) => r.id === room)!;
    expect(part.freeNights).toBe(5);
    expect(part.free).toEqual([{ from: ymd(d(598)), to: ymd(d(600)) }, { from: ymd(d(603)), to: ymd(d(606)) }]);
    expect(part.busy).toEqual([expect.objectContaining({ from: ymd(d(600)), to: ymd(d(603)), reservationId: busy.id })]);
  });
});
