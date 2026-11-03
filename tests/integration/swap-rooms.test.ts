/**
 * Swap rooms between two bookings (client, 3 Nov 2026) — real DB: the
 * serializable tx, the exclusion constraint, cross-property re-pointing.
 * Dates in 2027 so the past-date rule never trips.
 */
import { vi } from "vitest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPrismaClient } from "@/lib/db/client";
import type { SessionClaims } from "@/lib/auth/claims";

const authMock = vi.hoisted(() => ({ current: null as SessionClaims | null }));
vi.mock("@/lib/auth", () => ({
  requireUser: async () => {
    if (!authMock.current) throw new Error("no test user set");
    return authMock.current;
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

import { PROP_A_ID, PROP_B_ID, ROOM_101_ID, ROOM_102_ID, ROOM_104_ID, ROOM_201_ID, GUEST_RAVI_ID, GUEST_MEHTA_ID, USER_ADMIN_ID } from "../../prisma/seed/fixtures";
import { resetRoomsA } from "../../prisma/seed/01-property";
import { assembleClaims } from "@/lib/auth/claims";
import { createReservation } from "@/features/reservations/actions";
import { checkIn } from "@/features/reservations/lifecycle-actions";
import { swapRooms, swapCandidates } from "@/features/reservations/swap-actions";

const prisma = createPrismaClient();
const created: string[] = [];
const B_CAT = "cat_swap_test_b";
const B_ROOM = "room_swap_test_b1";

const body = (o: Record<string, unknown>) => ({ propertyId: PROP_A_ID, source: "DIRECT" as const, adults: 1, children: 0, ratePaise: 200_000, ...o });
async function book(o: Record<string, unknown>): Promise<string> {
  const r = await createReservation(body(o));
  if (!r.ok) throw new Error(r.error.message);
  created.push(r.data.id);
  return r.data.id;
}
const roomsOf = async (id: string) => (await prisma.roomAllocation.findMany({ where: { reservationId: id }, select: { roomId: true } })).map((x) => x.roomId).sort();

beforeAll(async () => {
  await prisma.roomCategory.upsert({ where: { id: B_CAT }, create: { id: B_CAT, propertyId: PROP_B_ID, name: "Swap test", baseRatePaise: 300_000 }, update: {} });
  await prisma.room.upsert({ where: { id: B_ROOM }, create: { id: B_ROOM, propertyId: PROP_B_ID, categoryId: B_CAT, number: "SW-1", status: "VACANT" }, update: {} });
});
beforeEach(async () => {
  authMock.current = await assembleClaims(prisma, USER_ADMIN_ID);
  await resetRoomsA(prisma);
});
afterEach(async () => {
  if (created.length) {
    await prisma.roomAllocation.deleteMany({ where: { reservationId: { in: created } } });
    await prisma.reservation.updateMany({ where: { id: { in: created } }, data: { status: "CHECKED_OUT" } });
    created.length = 0;
  }
});
afterAll(async () => {
  await prisma.roomAllocation.deleteMany({ where: { roomId: B_ROOM } });
  await prisma.$disconnect();
});

describe("swapRooms", () => {
  it("single ↔ single in one property: each guest takes the other's room for their own dates", async () => {
    const a = await book({ guestId: GUEST_RAVI_ID, roomIds: [ROOM_101_ID], checkInDate: "2027-10-10", checkOutDate: "2027-10-12" });
    const b = await book({ guestId: GUEST_MEHTA_ID, roomIds: [ROOM_201_ID], checkInDate: "2027-10-11", checkOutDate: "2027-10-14" });
    const cands = await swapCandidates(a);
    expect(cands.ok && cands.data.some((c) => c.id === b)).toBe(true);
    const res = await swapRooms({ reservationId: a, otherReservationId: b, reason: "upper floor" });
    expect(res.ok, JSON.stringify(res)).toBe(true);
    expect(await roomsOf(a)).toEqual([ROOM_201_ID]);
    expect(await roomsOf(b)).toEqual([ROOM_101_ID]);
    const ra = await prisma.roomAllocation.findFirstOrThrow({ where: { reservationId: a } });
    expect(ra.startDate.toISOString().slice(0, 10)).toBe("2027-10-10"); // A's own dates
    expect(await prisma.auditLog.count({ where: { action: "reservation:swap-room", entityId: { in: [a, b] } } })).toBe(2);
  });

  it("2-room unit ↔ 2-room unit", async () => {
    const a = await book({ guestId: GUEST_RAVI_ID, roomIds: [ROOM_101_ID, ROOM_102_ID], checkInDate: "2027-10-20", checkOutDate: "2027-10-22" });
    const b = await book({ guestId: GUEST_MEHTA_ID, roomIds: [ROOM_104_ID, ROOM_201_ID], checkInDate: "2027-10-20", checkOutDate: "2027-10-22" });
    expect((await swapRooms({ reservationId: a, otherReservationId: b })).ok).toBe(true);
    expect(await roomsOf(a)).toEqual([ROOM_104_ID, ROOM_201_ID].sort());
    expect(await roomsOf(b)).toEqual([ROOM_101_ID, ROOM_102_ID].sort());
  });

  it("across properties: each booking moves to the other property", async () => {
    const a = await book({ guestId: GUEST_RAVI_ID, roomIds: [ROOM_101_ID], checkInDate: "2027-11-01", checkOutDate: "2027-11-03" });
    const b = await book({ propertyId: PROP_B_ID, guestId: GUEST_MEHTA_ID, roomIds: [B_ROOM], checkInDate: "2027-11-02", checkOutDate: "2027-11-04" });
    expect((await swapRooms({ reservationId: a, otherReservationId: b })).ok).toBe(true);
    expect((await prisma.reservation.findUniqueOrThrow({ where: { id: a } })).propertyId).toBe(PROP_B_ID);
    expect((await prisma.reservation.findUniqueOrThrow({ where: { id: b } })).propertyId).toBe(PROP_A_ID);
    expect(await roomsOf(a)).toEqual([B_ROOM]);
    expect(await roomsOf(b)).toEqual([ROOM_101_ID]);
  });

  it("refuses when the other guest is in-house", async () => {
    const a = await book({ guestId: GUEST_RAVI_ID, roomIds: [ROOM_101_ID], checkInDate: "2027-12-01", checkOutDate: "2027-12-03" });
    const b = await book({ guestId: GUEST_MEHTA_ID, roomIds: [ROOM_201_ID], checkInDate: "2027-12-01", checkOutDate: "2027-12-03" });
    expect((await checkIn({ reservationId: b })).ok).toBe(true);
    const res = await swapRooms({ reservationId: a, otherReservationId: b });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.message).toMatch(/in-house/);
    expect(await roomsOf(a)).toEqual([ROOM_101_ID]); // nothing changed
  });

  it("refuses unlike units and a room that isn't free for the new guest's dates — nothing changes", async () => {
    const a = await book({ guestId: GUEST_RAVI_ID, roomIds: [ROOM_101_ID], checkInDate: "2027-12-10", checkOutDate: "2027-12-15" });
    const b = await book({ guestId: GUEST_MEHTA_ID, roomIds: [ROOM_201_ID], checkInDate: "2027-12-10", checkOutDate: "2027-12-11" });
    // Room 201 is taken by a third guest on 12 Dec — inside A's dates.
    await book({ guestId: GUEST_MEHTA_ID, roomIds: [ROOM_201_ID], checkInDate: "2027-12-12", checkOutDate: "2027-12-13" });
    const res = await swapRooms({ reservationId: a, otherReservationId: b });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.message).toMatch(/isn't free/);
    expect(await roomsOf(a)).toEqual([ROOM_101_ID]);
    expect(await roomsOf(b)).toEqual([ROOM_201_ID]);

    const two = await book({ guestId: GUEST_MEHTA_ID, roomIds: [ROOM_102_ID, ROOM_104_ID], checkInDate: "2027-12-20", checkOutDate: "2027-12-21" });
    const bad = await swapRooms({ reservationId: a, otherReservationId: two });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.message).toMatch(/like for like/);
  });
});
