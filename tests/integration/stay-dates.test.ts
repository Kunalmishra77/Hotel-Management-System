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

import { PROP_A_ID, GUEST_MEHTA_ID, USER_ADMIN_ID, ROOM_CATEGORY_A_DELUXE_ID } from "../../prisma/seed/fixtures";
import { assembleClaims } from "@/lib/auth/claims";
import { checkOut } from "@/features/reservations/lifecycle-actions";
import { shortenStay } from "@/features/reservations/shorten-actions";
import { postRoomCharges } from "@/features/billing/night-audit";

const prisma = createPrismaClient();
const DAY = 86_400_000;
const today = new Date(`${new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" })}T00:00:00Z`);
const d = (offset: number) => new Date(today.getTime() + offset * DAY);
const ymd = (x: Date) => x.toISOString().slice(0, 10);
const RATE = 250_000;
let roomSeq = 0;

/** An IN_HOUSE stay on its own fresh room, every booked night billed (as check-in does). */
async function inHouseStay(fromOffset: number, toOffset: number) {
  const tag = `${Date.now().toString(36)}${roomSeq++}`;
  const room = await prisma.room.create({ data: { propertyId: PROP_A_ID, categoryId: ROOM_CATEGORY_A_DELUXE_ID, number: `T${tag}`.slice(0, 12), status: "OCCUPIED" } });
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
  const c = await assembleClaims(prisma, USER_ADMIN_ID);
  if (!c) throw new Error("no claims");
  h.user = { ...c, activePropertyId: PROP_A_ID };
});
afterAll(async () => {
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
