/**
 * Split stay + partial availability (client: "a room free for part of the dates
 * stays empty") and the board-status guards on booking / cancel. Real DB: the
 * SERIALIZABLE booking tx, the `room_no_overlap` exclusion constraint, events.
 * Dates in 2027 so the past-date rule never trips.
 */
import { vi } from "vitest";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
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

import { PROP_A_ID, ROOM_101_ID, ROOM_102_ID, GUEST_RAVI_ID, GUEST_MEHTA_ID, USER_MANAGER_ID, USER_RECEPTION_A_ID } from "../../prisma/seed/fixtures";
import { resetRoomsA } from "../../prisma/seed/01-property";
import { assembleClaims } from "@/lib/auth/claims";
import { createReservation } from "@/features/reservations/actions";
import { searchAvailabilityGrid } from "@/features/reservations/availability-action";
import { checkIn, cancelReservation } from "@/features/reservations/lifecycle-actions";

const prisma = createPrismaClient();
const createdIds: string[] = [];

async function actAs(userId: string): Promise<void> {
  const claims = await assembleClaims(prisma, userId);
  if (!claims) throw new Error(`no claims for ${userId}`);
  authMock.current = claims;
}

function body(overrides: Record<string, unknown>) {
  return {
    propertyId: PROP_A_ID,
    guestId: GUEST_RAVI_ID,
    source: "DIRECT" as const,
    adults: 1,
    children: 0,
    ratePaise: 300_000,
    ...overrides,
  };
}

function track(res: { ok: boolean; data?: { id: string } }) {
  if (res.ok && res.data) createdIds.push(res.data.id);
}

beforeEach(async () => {
  authMock.current = null;
  await resetRoomsA(prisma);
});

afterEach(async () => {
  if (createdIds.length) {
    await prisma.roomAllocation.deleteMany({ where: { reservationId: { in: createdIds } } });
    // Line-bearing folios are append-only: neutralize their bookings, delete the rest.
    const folios = await prisma.folio.findMany({
      where: { reservationId: { in: createdIds } },
      select: { id: true, reservationId: true, _count: { select: { lines: true, payments: true } } },
    });
    const kept: string[] = [];
    for (const f of folios) {
      if (f._count.lines === 0 && f._count.payments === 0) await prisma.folio.delete({ where: { id: f.id } });
      else if (f.reservationId) kept.push(f.reservationId);
    }
    if (kept.length) await prisma.reservation.updateMany({ where: { id: { in: kept } }, data: { status: "CHECKED_OUT" } });
    await prisma.reservation.deleteMany({ where: { id: { in: createdIds.filter((id) => !kept.includes(id)) } } });
    createdIds.length = 0;
  }
  await resetRoomsA(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

/** Room 101 is taken on the night of 12 Aug by another guest. */
async function occupy101On12th(): Promise<void> {
  const other = await createReservation(body({ guestId: GUEST_MEHTA_ID, roomIds: [ROOM_101_ID], checkInDate: "2027-08-12", checkOutDate: "2027-08-13" }));
  track(other);
  expect(other.ok).toBe(true);
}

describe("partial availability grid", () => {
  it("shows a room that is free for only part of the dates, night by night", async () => {
    await actAs(USER_RECEPTION_A_ID);
    await occupy101On12th();
    const res = await searchAvailabilityGrid({ propertyId: PROP_A_ID, from: "2027-08-10", to: "2027-08-14" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.nights).toEqual(["2027-08-10", "2027-08-11", "2027-08-12", "2027-08-13"]);
    const r101 = res.data.rooms.find((r) => r.id === ROOM_101_ID)!;
    expect(r101.cells.map((c) => c.state)).toEqual(["free", "free", "booked", "free"]);
    expect(r101.freeNights).toBe(3);
  });
});

describe("split-stay booking", () => {
  it("books one guest into 101 then 102 as two allocation segments", async () => {
    await actAs(USER_RECEPTION_A_ID);
    await occupy101On12th();
    const res = await createReservation(body({
      roomIds: [ROOM_101_ID, ROOM_102_ID],
      checkInDate: "2027-08-10",
      checkOutDate: "2027-08-14",
      segments: [
        { roomId: ROOM_101_ID, startDate: "2027-08-10", endDate: "2027-08-12" },
        { roomId: ROOM_102_ID, startDate: "2027-08-12", endDate: "2027-08-14" },
      ],
    }));
    track(res);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const allocs = await prisma.roomAllocation.findMany({ where: { reservationId: res.data.id }, orderBy: { startDate: "asc" } });
    expect(allocs.map((a) => [a.roomId, a.startDate.toISOString().slice(0, 10), a.endDate.toISOString().slice(0, 10)])).toEqual([
      [ROOM_101_ID, "2027-08-10", "2027-08-12"],
      [ROOM_102_ID, "2027-08-12", "2027-08-14"],
    ]);
    const r = await prisma.reservation.findUniqueOrThrow({ where: { id: res.data.id } });
    expect(r.nights).toBe(4); // one bill, one nightly rate, every night
  });

  it("refuses a segment that overlaps another guest's night (no overbooking)", async () => {
    await actAs(USER_RECEPTION_A_ID);
    await occupy101On12th();
    const res = await createReservation(body({
      roomIds: [ROOM_101_ID, ROOM_102_ID],
      checkInDate: "2027-08-10",
      checkOutDate: "2027-08-14",
      segments: [
        { roomId: ROOM_101_ID, startDate: "2027-08-10", endDate: "2027-08-13" }, // includes the 12th
        { roomId: ROOM_102_ID, startDate: "2027-08-13", endDate: "2027-08-14" },
      ],
    }));
    track(res);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("ROOM_UNAVAILABLE");
  });

  it("refuses segments that leave a night without a room", async () => {
    await actAs(USER_RECEPTION_A_ID);
    const res = await createReservation(body({
      roomIds: [ROOM_101_ID, ROOM_102_ID],
      checkInDate: "2027-08-10",
      checkOutDate: "2027-08-14",
      segments: [
        { roomId: ROOM_101_ID, startDate: "2027-08-10", endDate: "2027-08-11" },
        { roomId: ROOM_102_ID, startDate: "2027-08-12", endDate: "2027-08-14" },
      ],
    }));
    track(res);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("VALIDATION_FAILED");
  });

  it("check-in occupies only the arrival room — the later room is not taken yet", async () => {
    await actAs(USER_RECEPTION_A_ID);
    const res = await createReservation(body({
      guestId: GUEST_MEHTA_ID,
      roomIds: [ROOM_101_ID, ROOM_102_ID],
      checkInDate: "2027-08-20",
      checkOutDate: "2027-08-23",
      segments: [
        { roomId: ROOM_101_ID, startDate: "2027-08-20", endDate: "2027-08-21" },
        { roomId: ROOM_102_ID, startDate: "2027-08-21", endDate: "2027-08-23" },
      ],
    }));
    track(res);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const ci = await checkIn({ reservationId: res.data.id });
    expect(ci.ok).toBe(true);
    expect((await prisma.room.findUniqueOrThrow({ where: { id: ROOM_101_ID } })).status).toBe("OCCUPIED");
    expect((await prisma.room.findUniqueOrThrow({ where: { id: ROOM_102_ID } })).status).not.toBe("OCCUPIED");
  });
});

describe("board-status guards (F-ROOM-2)", () => {
  it("cancelling a future booking does not mark a room vacant that is being cleaned", async () => {
    await actAs(USER_RECEPTION_A_ID);
    const res = await createReservation(body({ roomIds: [ROOM_101_ID], checkInDate: "2027-09-01", checkOutDate: "2027-09-03" }));
    track(res);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    await prisma.room.update({ where: { id: ROOM_101_ID }, data: { status: "HOUSEKEEPING" } });
    await actAs(USER_MANAGER_ID);
    const c = await cancelReservation({ reservationId: res.data.id, reason: "plans changed" });
    expect(c.ok).toBe(true);
    expect((await prisma.room.findUniqueOrThrow({ where: { id: ROOM_101_ID } })).status).toBe("HOUSEKEEPING");
  });
});
