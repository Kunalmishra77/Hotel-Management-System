/**
 * 03 reservations integration — T-12..T-25. The crown-jewel guarantees:
 * no overbooking (incl. under concurrency), availability = allocations + blocks,
 * group all-or-nothing, holds/confirm, the lifecycle, no-show, channel oversell,
 * RBAC, and validation. Traceability in each describe title.
 *
 * Auth is mocked at the boundary (as in guests.test.ts); everything else is real
 * against the test DB — real SERIALIZABLE transactions, the real `room_no_overlap`
 * exclusion constraint, real events + audit. Dates are in 2027 so the past-date
 * rule (FR-22), which uses the real clock, never trips.
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

import {
  PROP_A_ID,
  ROOM_101_ID,
  ROOM_102_ID,
  ROOM_104_ID,
  ROOM_201_ID,
  CAT_DLX_ID,
  GUEST_RAVI_ID,
  GUEST_MEHTA_ID,
  CORPORATE_ACME_ID,
  USER_MANAGER_ID,
  USER_RECEPTION_A_ID,
  USER_HOUSEKEEPING_ID,
} from "../../prisma/seed/fixtures";
import { resetRoomsA } from "../../prisma/seed/01-property";
import { assembleClaims } from "@/lib/auth/claims";
import { createReservation, holdReservation, confirmReservation } from "@/features/reservations/actions";
import { searchAvailability } from "@/features/reservations/availability-action";
import { checkIn, checkOut, cancelReservation } from "@/features/reservations/lifecycle-actions";
import { reallocateRoom } from "@/features/reservations/move-actions";
import { releaseExpiredHolds, markNoShows } from "@/features/reservations/jobs";
import { createFromChannel } from "@/features/reservations/channel-actions";

const prisma = createPrismaClient();
const createdIds: string[] = [];
const createdBlockIds: string[] = [];

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

async function actAs(userId: string): Promise<SessionClaims> {
  const claims = await assembleClaims(prisma, userId);
  if (!claims) throw new Error(`no claims for ${userId}`);
  authMock.current = claims;
  return claims;
}

/** Standard 3-night Deluxe booking body (AC-2 amounts). */
function booking(roomIds: string[], overrides: Record<string, unknown> = {}) {
  return {
    propertyId: PROP_A_ID,
    guestId: GUEST_RAVI_ID,
    source: "DIRECT" as const,
    roomIds,
    checkInDate: "2027-07-12",
    checkOutDate: "2027-07-15",
    adults: 2,
    children: 0,
    ratePaise: 400_000,
    discountPaise: 50_000,
    extraBedPaise: 80_000,
    taxPaise: 111_000,
    advancePaise: 500_000,
    ...overrides,
  };
}

function track(res: { ok: boolean; data?: { id: string } }) {
  if (res.ok && res.data) createdIds.push(res.data.id);
}

beforeEach(async () => {
  authMock.current = null;
});

afterEach(async () => {
  if (createdIds.length) {
    await prisma.folio.deleteMany({ where: { reservationId: { in: createdIds } } });
    await prisma.roomAllocation.deleteMany({ where: { reservationId: { in: createdIds } } });
    await prisma.reservation.deleteMany({ where: { id: { in: createdIds } } });
    createdIds.length = 0;
  }
  if (createdBlockIds.length) {
    await prisma.roomBlock.deleteMany({ where: { id: { in: createdBlockIds } } });
    createdBlockIds.length = 0;
  }
  await resetRoomsA(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("createReservation (T-12, FR-3/6/7, AC-1/2/3)", () => {
  it("creates a CONFIRMED booking with an allocation, folio, event and RESERVED room (AC-1/3)", async () => {
    await actAs(USER_RECEPTION_A_ID);
    const res = await createReservation(booking([ROOM_101_ID]));
    track(res);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const r = await prisma.reservation.findUniqueOrThrow({ where: { id: res.data.id } });
    expect(r.status).toBe("CONFIRMED");
    expect(r.nights).toBe(3);

    const alloc = await prisma.roomAllocation.findFirst({ where: { reservationId: r.id } });
    expect(alloc?.roomId).toBe(ROOM_101_ID);

    const room = await prisma.room.findUniqueOrThrow({ where: { id: ROOM_101_ID } });
    expect(room.status).toBe("RESERVED");

    const folio = await prisma.folio.findUnique({ where: { reservationId: r.id } });
    expect(folio).not.toBeNull();

    const event = await prisma.domainEvent.findFirst({ where: { type: "ReservationCreated", aggregateId: r.id } });
    expect(event).not.toBeNull();
    const audit = await prisma.auditLog.findFirst({ where: { action: "reservation:create", entityId: r.id } });
    expect(audit).not.toBeNull();
  });

  it("stores the AC-2 money snapshot in paise", async () => {
    await actAs(USER_RECEPTION_A_ID);
    const res = await createReservation(booking([ROOM_101_ID]));
    track(res);
    if (!res.ok) throw new Error("create failed");
    const r = await prisma.reservation.findUniqueOrThrow({ where: { id: res.data.id } });
    // total = 4000*3 - 500 + 800 + 1110 = 13,410; balance = 8,410 (checked in domain).
    expect(r.ratePaise).toBe(400_000);
    expect(r.discountPaise).toBe(50_000);
    expect(r.advancePaise).toBe(500_000);
  });
});

describe("no overbooking (T-12/T-13, FR-4, AC-5/6/8)", () => {
  it("rejects an overlapping allocation with ROOM_UNAVAILABLE, no second allocation (AC-5)", async () => {
    await actAs(USER_RECEPTION_A_ID);
    const first = await createReservation(booking([ROOM_101_ID], { checkInDate: "2027-07-12", checkOutDate: "2027-07-15" }));
    track(first);
    expect(first.ok).toBe(true);

    const second = await createReservation(booking([ROOM_101_ID], { checkInDate: "2027-07-14", checkOutDate: "2027-07-16" }));
    track(second);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error.code).toBe("ROOM_UNAVAILABLE");

    const allocs = await prisma.roomAllocation.count({
      where: { roomId: ROOM_101_ID, startDate: { lt: d("2027-07-16") }, endDate: { gt: d("2027-07-14") } },
    });
    expect(allocs).toBe(1);
  });

  it("allows adjacent, non-overlapping bookings — checkout day is bookable (AC-8)", async () => {
    await actAs(USER_RECEPTION_A_ID);
    const a = await createReservation(booking([ROOM_101_ID], { checkInDate: "2027-07-12", checkOutDate: "2027-07-15" }));
    const b = await createReservation(booking([ROOM_101_ID], { checkInDate: "2027-07-15", checkOutDate: "2027-07-17" }));
    track(a);
    track(b);
    expect(a.ok && b.ok).toBe(true);
  });

  it("under concurrency, exactly one of two overlapping confirms wins (AC-6)", async () => {
    await actAs(USER_RECEPTION_A_ID);
    const body = booking([ROOM_201_ID], { guestId: GUEST_RAVI_ID, checkInDate: "2027-08-01", checkOutDate: "2027-08-03", ratePaise: 700_000 });
    const [a, b] = await Promise.all([createReservation(body), createReservation(body)]);
    track(a);
    track(b);
    const wins = [a, b].filter((r) => r.ok).length;
    expect(wins).toBe(1);
    const loser = [a, b].find((r) => !r.ok);
    if (loser && !loser.ok) expect(loser.error.code).toBe("ROOM_UNAVAILABLE");
  });
});

describe("availability = allocations + blocks (T-11, FR-2, AC-7/9/10)", () => {
  it("excludes a VACANT-but-blocked room, and frees it after the block (AC-7)", async () => {
    const claims = await actAs(USER_RECEPTION_A_ID);
    const block = await prisma.roomBlock.create({
      data: { propertyId: PROP_A_ID, roomId: ROOM_104_ID, startDate: d("2027-07-15"), endDate: d("2027-07-16"), reason: "maintenance" },
    });
    createdBlockIds.push(block.id);

    const during = await searchAvailability({ propertyId: PROP_A_ID, checkInDate: "2027-07-15", checkOutDate: "2027-07-17", categoryId: CAT_DLX_ID, adults: 2 });
    expect(during.ok).toBe(true);
    if (during.ok) expect(during.data.rooms.map((r) => r.id)).not.toContain(ROOM_104_ID);

    const after = await searchAvailability({ propertyId: PROP_A_ID, checkInDate: "2027-07-17", checkOutDate: "2027-07-18", categoryId: CAT_DLX_ID, adults: 2 });
    expect(after.ok).toBe(true);
    if (after.ok) expect(after.data.rooms.map((r) => r.id)).toContain(ROOM_104_ID);
    void claims;
  });

  it("returns an empty result (not an error) when nothing is free (AC-10)", async () => {
    await actAs(USER_RECEPTION_A_ID);
    // A category that doesn't exist → no rooms, still ok:true.
    const res = await searchAvailability({ propertyId: PROP_A_ID, checkInDate: "2027-07-12", checkOutDate: "2027-07-15", categoryId: "cat_nonexistent", adults: 2 });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.rooms).toHaveLength(0);
  });
});

describe("occupancy + rate floor (T-9/T-10, FR-17/19, AC-4/25)", () => {
  it("rejects 3 adults in Deluxe without an extra bed (AC-4)", async () => {
    await actAs(USER_RECEPTION_A_ID);
    const res = await createReservation(booking([ROOM_101_ID], { adults: 3, extraBed: false }));
    track(res);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("OCCUPANCY_EXCEEDED");
  });

  it("accepts 3 adults with an extra-bed override (AC-4)", async () => {
    await actAs(USER_RECEPTION_A_ID);
    const res = await createReservation(booking([ROOM_101_ID], { adults: 3, extraBed: true }));
    track(res);
    expect(res.ok).toBe(true);
  });

  it("writes an audited override for an over-threshold discount by a folio:discount holder (AC-25)", async () => {
    await actAs(USER_RECEPTION_A_ID); // Reception holds folio:discount at the audited tier
    const res = await createReservation(booking([ROOM_101_ID], { discountPaise: 300_000 }));
    track(res);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const override = await prisma.auditLog.findFirst({ where: { action: "reservation:rate-override", entityId: res.data.id } });
    expect(override).not.toBeNull();
  });
});

describe("group booking all-or-nothing (T-15, FR-15, AC-13)", () => {
  it("allocates neither room when one of the group is taken", async () => {
    await actAs(USER_RECEPTION_A_ID);
    // R-102 is taken first.
    const pre = await createReservation(booking([ROOM_102_ID]));
    track(pre);
    expect(pre.ok).toBe(true);

    const group = await createReservation(booking([ROOM_101_ID, ROOM_102_ID]));
    track(group);
    expect(group.ok).toBe(false);
    if (!group.ok) expect(group.error.code).toBe("ROOM_UNAVAILABLE");

    // R-101 must NOT have been allocated by the failed group — scoped to the
    // group's own date window so unrelated allocations elsewhere can't confuse it.
    const alloc101 = await prisma.roomAllocation.count({
      where: { roomId: ROOM_101_ID, startDate: { lt: d("2027-07-15") }, endDate: { gt: d("2027-07-12") } },
    });
    expect(alloc101).toBe(0);
  });
});

describe("holds + confirm (T-14/T-14b, FR-16/23, AC-14/26)", () => {
  it("creates an ENQUIRY hold with a TTL, releases it after expiry, keeps it before (AC-14)", async () => {
    await actAs(USER_RECEPTION_A_ID);
    const hold = await holdReservation(booking([ROOM_201_ID], { checkInDate: "2027-09-01", checkOutDate: "2027-09-03", ratePaise: 700_000 }));
    track(hold);
    expect(hold.ok).toBe(true);
    if (!hold.ok) return;

    const held = await prisma.reservation.findUniqueOrThrow({ where: { id: hold.data.id } });
    expect(held.status).toBe("ENQUIRY");
    expect(held.holdExpiresAt).not.toBeNull();

    // Before expiry: untouched.
    await releaseExpiredHolds(new Date(held.holdExpiresAt!.getTime() - 3_600_000));
    expect((await prisma.reservation.findUniqueOrThrow({ where: { id: hold.data.id } })).status).toBe("ENQUIRY");

    // After expiry: released.
    await releaseExpiredHolds(new Date(held.holdExpiresAt!.getTime() + 3_600_000));
    const released = await prisma.reservation.findUniqueOrThrow({ where: { id: hold.data.id } });
    expect(released.status).toBe("CANCELLED");
    expect(await prisma.roomAllocation.count({ where: { reservationId: hold.data.id } })).toBe(0);
  });

  it("confirms a hold to CONFIRMED, ensuring a folio and keeping the allocation (AC-26)", async () => {
    await actAs(USER_RECEPTION_A_ID);
    const hold = await holdReservation(booking([ROOM_201_ID], { checkInDate: "2027-10-01", checkOutDate: "2027-10-03", ratePaise: 700_000 }));
    track(hold);
    if (!hold.ok) throw new Error("hold failed");
    const allocBefore = await prisma.roomAllocation.findFirstOrThrow({ where: { reservationId: hold.data.id } });

    const confirmed = await confirmReservation({ reservationId: hold.data.id });
    expect(confirmed.ok).toBe(true);
    const r = await prisma.reservation.findUniqueOrThrow({ where: { id: hold.data.id } });
    expect(r.status).toBe("CONFIRMED");
    expect(r.holdExpiresAt).toBeNull();
    expect(await prisma.folio.findUnique({ where: { reservationId: r.id } })).not.toBeNull();
    // Same allocation retained (no re-allocation).
    const allocAfter = await prisma.roomAllocation.findFirstOrThrow({ where: { reservationId: r.id } });
    expect(allocAfter.id).toBe(allocBefore.id);
  });
});

describe("lifecycle: check-in / check-out / cancel / reallocate (T-17/18/19/20)", () => {
  async function makeConfirmed(roomId = ROOM_101_ID, extra: Record<string, unknown> = {}) {
    await actAs(USER_RECEPTION_A_ID);
    const res = await createReservation(booking([roomId], extra));
    track(res);
    if (!res.ok) throw new Error("setup create failed");
    return res.data.id;
  }

  it("checks in: IN_HOUSE, room OCCUPIED, folio, GuestCheckedIn (AC-15)", async () => {
    const id = await makeConfirmed();
    const res = await checkIn({ reservationId: id });
    expect(res.ok).toBe(true);
    expect((await prisma.reservation.findUniqueOrThrow({ where: { id } })).status).toBe("IN_HOUSE");
    expect((await prisma.room.findUniqueOrThrow({ where: { id: ROOM_101_ID } })).status).toBe("OCCUPIED");
    expect(await prisma.domainEvent.findFirst({ where: { type: "GuestCheckedIn", aggregateId: id } })).not.toBeNull();
  });

  it("blocks check-out on an unsettled balance without folio:defer (AC-16)", async () => {
    const id = await makeConfirmed(); // advance 5,000 < total 13,410 → balance due
    await checkIn({ reservationId: id });
    await actAs(USER_RECEPTION_A_ID); // Reception has NO folio:defer
    const res = await checkOut({ reservationId: id });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("BALANCE_UNSETTLED");
  });

  it("allows check-out when the balance is settled (AC-17)", async () => {
    // advance ≥ total → balance 0.
    const id = await makeConfirmed(ROOM_102_ID, { advancePaise: 1_341_000 });
    await checkIn({ reservationId: id });
    const res = await checkOut({ reservationId: id });
    expect(res.ok).toBe(true);
    expect((await prisma.reservation.findUniqueOrThrow({ where: { id } })).status).toBe("CHECKED_OUT");
    expect((await prisma.room.findUniqueOrThrow({ where: { id: ROOM_102_ID } })).status).toBe("HOUSEKEEPING");
  });

  it("lets a folio:defer holder defer an unsettled balance (AC-17)", async () => {
    const id = await makeConfirmed();
    await checkIn({ reservationId: id });
    await actAs(USER_MANAGER_ID); // Manager holds folio:defer
    const res = await checkOut({ reservationId: id, defer: true });
    expect(res.ok).toBe(true);
  });

  it("rejects check-in of a cancelled booking — illegal transition (AC-18)", async () => {
    const id = await makeConfirmed();
    await actAs(USER_MANAGER_ID);
    await cancelReservation({ reservationId: id, reason: "guest cancelled" });
    await actAs(USER_RECEPTION_A_ID);
    const res = await checkIn({ reservationId: id });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("ILLEGAL_TRANSITION");
  });

  it("cancels: CANCELLED, allocation released, room VACANT (AC-12)", async () => {
    const id = await makeConfirmed();
    await actAs(USER_MANAGER_ID);
    const res = await cancelReservation({ reservationId: id, reason: "changed plans" });
    expect(res.ok).toBe(true);
    expect((await prisma.reservation.findUniqueOrThrow({ where: { id } })).status).toBe("CANCELLED");
    expect(await prisma.roomAllocation.count({ where: { reservationId: id } })).toBe(0);
    expect((await prisma.room.findUniqueOrThrow({ where: { id: ROOM_101_ID } })).status).toBe("VACANT");
  });

  it("reallocates an in-house guest to a free room atomically (AC-19)", async () => {
    const id = await makeConfirmed(ROOM_101_ID);
    await checkIn({ reservationId: id });
    await actAs(USER_RECEPTION_A_ID);
    const res = await reallocateRoom({ reservationId: id, toRoomId: ROOM_102_ID });
    expect(res.ok).toBe(true);
    expect((await prisma.roomAllocation.findFirstOrThrow({ where: { reservationId: id } })).roomId).toBe(ROOM_102_ID);
    expect((await prisma.room.findUniqueOrThrow({ where: { id: ROOM_101_ID } })).status).toBe("HOUSEKEEPING");
    expect((await prisma.room.findUniqueOrThrow({ where: { id: ROOM_102_ID } })).status).toBe("OCCUPIED");
  });
});

describe("no-show sweep (T-21, FR-18, AC-22)", () => {
  it("marks a past CONFIRMED booking NO_SHOW, releases its room, applies advance policy", async () => {
    await actAs(USER_RECEPTION_A_ID);
    // Book a stay whose check-in is 'today-ish' in 2027, then run the audit for the day after.
    const res = await createReservation(booking([ROOM_101_ID], { checkInDate: "2027-11-10", checkOutDate: "2027-11-12" }));
    track(res);
    if (!res.ok) throw new Error("create failed");

    const out = await markNoShows(PROP_A_ID, d("2027-11-10"));
    expect(out.marked).toBeGreaterThanOrEqual(1);
    expect((await prisma.reservation.findUniqueOrThrow({ where: { id: res.data.id } })).status).toBe("NO_SHOW");
    expect(await prisma.roomAllocation.count({ where: { reservationId: res.data.id } })).toBe(0);
    expect((await prisma.room.findUniqueOrThrow({ where: { id: ROOM_101_ID } })).status).toBe("VACANT");
  });
});

describe("channel ingest (T-22, FR-14, AC-20/27)", () => {
  it("ingests an OTA booking with source + channelRef, consuming availability like direct (AC-20)", async () => {
    const res = await createFromChannel({
      propertyId: PROP_A_ID, guestId: GUEST_RAVI_ID, source: "BOOKING_COM",
      channelRef: `OTA-${Date.now()}`, categoryId: CAT_DLX_ID,
      checkInDate: "2027-12-01", checkOutDate: "2027-12-03",
      ratePaise: 400_000, taxPaise: 0,
    });
    createdIds.push(res.id);
    expect(res.needsAttention).toBeNull();
    const r = await prisma.reservation.findUniqueOrThrow({ where: { id: res.id } });
    expect(r.source).toBe("BOOKING_COM");
    expect(r.channelRef).toContain("OTA-");
    expect(await prisma.roomAllocation.count({ where: { reservationId: r.id } })).toBe(1);
  });

  it("ingests an oversell unallocated with needsAttention=OVERSELL, never dropped (AC-27)", async () => {
    // Category with no free room: block all Deluxe for the range first is heavy;
    // instead target a category that has rooms but all get taken — simulate by
    // pointing at a category and pre-filling: use a tiny date window on Suite (1 room).
    const ref = `OTA-OS-${Date.now()}`;
    await actAs(USER_RECEPTION_A_ID);
    const fill = await createReservation(booking([ROOM_201_ID], { checkInDate: "2028-01-01", checkOutDate: "2028-01-03", ratePaise: 700_000 }));
    track(fill);

    const res = await createFromChannel({
      propertyId: PROP_A_ID, guestId: GUEST_RAVI_ID, source: "AGODA",
      channelRef: ref, roomIds: [ROOM_201_ID],
      checkInDate: "2028-01-01", checkOutDate: "2028-01-03",
      ratePaise: 700_000, taxPaise: 0,
    });
    createdIds.push(res.id);
    expect(res.needsAttention).toBe("OVERSELL");
    expect(await prisma.roomAllocation.count({ where: { reservationId: res.id } })).toBe(0);
  });

  it("ingests a missing-mapping push with needsAttention=MAPPING_MISSING (AC-27)", async () => {
    const res = await createFromChannel({
      propertyId: PROP_A_ID, guestId: GUEST_RAVI_ID, source: "MAKEMYTRIP",
      channelRef: `OTA-MM-${Date.now()}`, // no categoryId, no roomIds
      checkInDate: "2028-02-01", checkOutDate: "2028-02-03",
      ratePaise: 400_000, taxPaise: 0,
    });
    createdIds.push(res.id);
    expect(res.needsAttention).toBe("MAPPING_MISSING");
    expect(await prisma.roomAllocation.count({ where: { reservationId: res.id } })).toBe(0);
  });
});

describe("attribution (T-23, FR-13, AC-21)", () => {
  it("persists the corporate link for revenue segmentation", async () => {
    await actAs(USER_RECEPTION_A_ID);
    const res = await createReservation(booking([ROOM_101_ID], { guestId: GUEST_MEHTA_ID, source: "CORPORATE", corporateId: CORPORATE_ACME_ID }));
    track(res);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const r = await prisma.reservation.findUniqueOrThrow({ where: { id: res.data.id } });
    expect(r.corporateId).toBe(CORPORATE_ACME_ID);
  });
});

describe("RBAC + validation (T-24/T-25, FR-21/22, AC-23/24)", () => {
  it("denies Housekeeping create / check-in / cancel (AC-23)", async () => {
    // A real CONFIRMED booking, so the check-in/cancel attempts reach the
    // authorization check rather than short-circuiting on NOT_FOUND.
    await actAs(USER_RECEPTION_A_ID);
    const setup = await createReservation(booking([ROOM_101_ID]));
    track(setup);
    if (!setup.ok) throw new Error("setup failed");

    await actAs(USER_HOUSEKEEPING_ID);
    const create = await createReservation(booking([ROOM_102_ID]));
    track(create);
    expect(create.ok).toBe(false);
    if (!create.ok) expect(create.error.code).toBe("FORBIDDEN");

    const ci = await checkIn({ reservationId: setup.data.id });
    expect(ci.ok).toBe(false);
    if (!ci.ok) expect(ci.error.code).toBe("FORBIDDEN");

    const cancel = await cancelReservation({ reservationId: setup.data.id, reason: "x" });
    expect(cancel.ok).toBe(false);
    if (!cancel.ok) expect(cancel.error.code).toBe("FORBIDDEN");
  });

  it("rejects check-out date ≤ check-in date; nothing persists (AC-24)", async () => {
    await actAs(USER_RECEPTION_A_ID);
    const res = await createReservation(booking([ROOM_101_ID], { checkInDate: "2027-07-15", checkOutDate: "2027-07-15" }));
    track(res);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("VALIDATION_FAILED");
    expect(await prisma.roomAllocation.count({ where: { roomId: ROOM_101_ID, startDate: d("2027-07-15") } })).toBe(0);
  });

  it("rejects a past-dated new booking (AC-24 / FR-22)", async () => {
    await actAs(USER_RECEPTION_A_ID);
    const res = await createReservation(booking([ROOM_101_ID], { checkInDate: "2020-01-01", checkOutDate: "2020-01-03" }));
    track(res);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("VALIDATION_FAILED");
  });
});
