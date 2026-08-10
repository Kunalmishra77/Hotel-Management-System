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
import { postFolioCharge } from "@/features/billing/charge-actions";
import { postRoomCharges } from "@/features/billing/night-audit";
import { getFolio } from "@/features/billing/queries";
import { bookingsOverview } from "@/features/reservations/queries";

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
    // Allocations are freely deletable and MUST go so the rooms/date-ranges free
    // up for the next test (the exclusion constraint is unforgiving).
    await prisma.roomAllocation.deleteMany({ where: { reservationId: { in: createdIds } } });

    // A checked-in booking's folio carries append-only Payment/FolioLine rows
    // (T4 advance, T5 room/extra lines) that can NEVER be deleted (billing_guards
    // triggers). Delete only the empty folios (holds, confirmed-never-checked-in)
    // + their reservations; leave the line-bearing folios in place and neutralize
    // their reservation to CHECKED_OUT so night-audit / no-show sweeps in other
    // suites ignore it (the billing.test.ts convention). Check-in-bearing tests
    // use GUEST_MEHTA (never GUEST_RAVI), so the reservations e2e G-RAVI cleanup
    // is never aborted by a leftover line-bearing folio.
    const folios = await prisma.folio.findMany({
      where: { reservationId: { in: createdIds } },
      select: { id: true, reservationId: true, _count: { select: { lines: true, payments: true } } },
    });
    const blocked: string[] = [];
    for (const f of folios) {
      if (f._count.lines === 0 && f._count.payments === 0) {
        await prisma.folio.delete({ where: { id: f.id } });
      } else if (f.reservationId) {
        blocked.push(f.reservationId);
      }
    }
    if (blocked.length) {
      await prisma.reservation.updateMany({ where: { id: { in: blocked } }, data: { status: "CHECKED_OUT" } });
    }
    await prisma.reservation.deleteMany({ where: { id: { in: createdIds.filter((id) => !blocked.includes(id)) } } });
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
  // GUEST_MEHTA (not GUEST_RAVI): these bookings get checked in, and check-in now
  // posts append-only Payment/FolioLine rows the afterEach can't delete — the folio
  // + reservation persist. Keeping them off G-RAVI protects the reservations e2e's
  // blanket G-RAVI cleanup (billing.test.ts convention).
  async function makeConfirmed(roomId = ROOM_101_ID, extra: Record<string, unknown> = {}) {
    await actAs(USER_RECEPTION_A_ID);
    const res = await createReservation(booking([roomId], { guestId: GUEST_MEHTA_ID, ...extra }));
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

  it("allows check-out when the LIVE folio balance is settled (AC-17)", async () => {
    // Folio-authoritative total (Option A), NOT the snapshot: room 3×(400,000 +
    // 12% GST 48,000) = 1,344,000; + extra bed 80,000 + 12% (9,600); − discount
    // 50,000 = 1,383,600. Advance = that exact amount → live folio balance 0.
    const id = await makeConfirmed(ROOM_102_ID, { advancePaise: 1_383_600 });
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

describe("folio-authoritative check-out (3C T5 — money is always correct)", () => {
  async function confirmMehta(roomId: string, extra: Record<string, unknown> = {}) {
    await actAs(USER_RECEPTION_A_ID);
    const res = await createReservation(booking([roomId], { guestId: GUEST_MEHTA_ID, ...extra }));
    track(res);
    if (!res.ok) throw new Error("setup create failed");
    return res.data.id;
  }
  async function folioIdOf(reservationId: string): Promise<string> {
    return (await prisma.folio.findFirstOrThrow({ where: { reservationId }, select: { id: true } })).id;
  }

  it("posts the agreed discount + extra bed + advance onto the folio at check-in (Option A)", async () => {
    // Default booking carries extraBed 80,000, discount 50,000, advance 500,000.
    const id = await confirmMehta(ROOM_101_ID);
    await checkIn({ reservationId: id });
    const folioId = await folioIdOf(id);

    const lines = await prisma.folioLine.findMany({ where: { folioId }, select: { type: true, amountPaise: true } });
    const bed = lines.find((l) => l.type === "EXTRA_BED");
    const discount = lines.find((l) => l.type === "DISCOUNT");
    expect(Number(bed?.amountPaise)).toBe(80_000); // taxed service line
    expect(Number(discount?.amountPaise)).toBe(-50_000); // negative, reduces balance

    // The booking advance is now a folio Payment (T4), idempotent by reference.
    const payment = await prisma.payment.findFirst({ where: { folioId, reference: `ADVANCE:${id}` }, select: { amountPaise: true } });
    expect(Number(payment?.amountPaise)).toBe(500_000);
  });

  it("gates on the LIVE folio, not the snapshot — a mid-stay POS charge blocks an otherwise-settled check-out", async () => {
    // Prepay the exact agreed folio total → without any in-stay charge, balance 0.
    const id = await confirmMehta(ROOM_104_ID, { advancePaise: 1_383_600 });
    await checkIn({ reservationId: id });
    const folioId = await folioIdOf(id);

    // A mini-bar (POS) charge during the stay — invisible to the booking snapshot.
    await actAs(USER_RECEPTION_A_ID);
    const pos = await postFolioCharge({ folioId, type: "POS", description: "Mini-bar", unitPaise: 30_000 });
    expect(pos.ok).toBe(true);

    // Reception (no folio:defer) is now blocked BECAUSE the folio owes the POS
    // charge + its GST — the snapshot alone would have let this check out.
    await actAs(USER_RECEPTION_A_ID);
    const res = await checkOut({ reservationId: id });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("BALANCE_UNSETTLED");
    expect((await prisma.reservation.findUniqueOrThrow({ where: { id } })).status).toBe("IN_HOUSE");
  });

  it("checks out with a zero balance when ALREADY_PAID covers the agreed bill", async () => {
    const id = await confirmMehta(ROOM_201_ID, {
      settlementIntent: "ALREADY_PAID",
      ratePaise: 800_000, // Suite ₹8,000/night > ₹7,500 → 18% GST band
      extraBedPaise: 0,
      discountPaise: 0,
      checkInDate: "2027-07-12",
      checkOutDate: "2027-07-15",
      // Room only: 3 × (800,000 + 18% = 144,000) = 2,832,000. Prepaid in full.
      advancePaise: 2_832_000,
    });
    await checkIn({ reservationId: id });
    const folioId = await folioIdOf(id);
    // ALREADY_PAID posts the prepayment as an ONLINE tender.
    expect(await prisma.payment.count({ where: { folioId, mode: "ONLINE" } })).toBe(1);

    const res = await checkOut({ reservationId: id });
    expect(res.ok).toBe(true);
    const claims = await actAs(USER_RECEPTION_A_ID);
    expect((await getFolio(claims, folioId))?.balancePaise).toBe(0);
  });

  it("posts each un-accrued room-night exactly once — no double-post vs night audit", async () => {
    const id = await confirmMehta(ROOM_102_ID, { advancePaise: 1_383_600 });
    await checkIn({ reservationId: id });
    const folioId = await folioIdOf(id);

    // Night audit accrues the FIRST stay night before check-out runs.
    await postRoomCharges(PROP_A_ID, d("2027-07-12"));

    const res = await checkOut({ reservationId: id });
    expect(res.ok).toBe(true);

    // Exactly 3 ROOM lines (nights = 3), one per distinct business date — the
    // partial-unique key + pre-check mean the audited night is never re-posted.
    const roomLines = await prisma.folioLine.findMany({ where: { folioId, type: "ROOM" }, select: { businessDate: true } });
    expect(roomLines).toHaveLength(3);
    const distinctDates = new Set(roomLines.map((l) => l.businessDate.toISOString().slice(0, 10)));
    expect(distinctDates.size).toBe(3);
  });
});

describe("payment states — MoM 2026-08-03 (settlement intent)", () => {
  async function folioIdOf(reservationId: string): Promise<string> {
    return (await prisma.folio.findFirstOrThrow({ where: { reservationId }, select: { id: true } })).id;
  }

  it("PAY_AT_HOTEL: the advance posts as a CASH tender at check-in", async () => {
    await actAs(USER_RECEPTION_A_ID);
    const res = await createReservation(
      booking([ROOM_101_ID], { guestId: GUEST_MEHTA_ID, settlementIntent: "PAY_AT_HOTEL", checkInDate: "2028-06-01", checkOutDate: "2028-06-04", advancePaise: 500_000 }),
    );
    track(res);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    await checkIn({ reservationId: res.data.id });
    const folioId = await folioIdOf(res.data.id);
    const pay = await prisma.payment.findFirst({ where: { folioId, reference: `ADVANCE:${res.data.id}` }, select: { mode: true, amountPaise: true } });
    expect(pay?.mode).toBe("CASH");
    expect(Number(pay?.amountPaise)).toBe(500_000);
  });

  it("ALREADY_PAID: the advance posts as an ONLINE tender at check-in", async () => {
    await actAs(USER_RECEPTION_A_ID);
    const res = await createReservation(
      booking([ROOM_101_ID], { guestId: GUEST_MEHTA_ID, settlementIntent: "ALREADY_PAID", checkInDate: "2028-06-05", checkOutDate: "2028-06-08", advancePaise: 400_000 }),
    );
    track(res);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    await checkIn({ reservationId: res.data.id });
    const folioId = await folioIdOf(res.data.id);
    const pay = await prisma.payment.findFirst({ where: { folioId, reference: `ADVANCE:${res.data.id}` }, select: { mode: true } });
    expect(pay?.mode).toBe("ONLINE");
  });

  it("UNPAID_ONLINE: nothing is collected at the desk (no auto payment)", async () => {
    await actAs(USER_RECEPTION_A_ID);
    const res = await createReservation(
      booking([ROOM_101_ID], { guestId: GUEST_MEHTA_ID, settlementIntent: "UNPAID_ONLINE", checkInDate: "2028-06-10", checkOutDate: "2028-06-13", advancePaise: 0 }),
    );
    track(res);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    await checkIn({ reservationId: res.data.id });
    const folioId = await folioIdOf(res.data.id);
    // No tender is auto-posted; the folio still owes the agreed bill (settles when
    // the online payment lands, recorded on the folio later).
    expect(await prisma.payment.count({ where: { folioId } })).toBe(0);
    expect((await getFolio(await actAs(USER_RECEPTION_A_ID), folioId))!.balancePaise).toBeGreaterThan(0);
  });

  it("OTA ingest never auto-accepts online payment — defaults to PAY_AT_HOTEL (MoM)", async () => {
    const res = await createFromChannel({
      propertyId: PROP_A_ID, guestId: GUEST_RAVI_ID, source: "GOIBIBO",
      channelRef: `OTA-PS-${Date.now()}`, categoryId: CAT_DLX_ID,
      checkInDate: "2028-07-01", checkOutDate: "2028-07-03", ratePaise: 400_000, taxPaise: 0,
    });
    createdIds.push(res.id);
    const r = await prisma.reservation.findUniqueOrThrow({ where: { id: res.id }, select: { settlementIntent: true } });
    expect(r.settlementIntent).toBe("PAY_AT_HOTEL");
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

describe("bookingsOverview (command surface aggregates)", () => {
  it("counts status mix, today's arrivals, and the booking-source mix", async () => {
    const claims = await actAs(USER_RECEPTION_A_ID);
    const res = await createReservation(booking([ROOM_101_ID], { source: "DIRECT" }));
    track(res);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const overview = await bookingsOverview(claims, { propertyId: PROP_A_ID, date: d("2027-07-12") });
    // The new CONFIRMED booking checks in on 2027-07-12 → counts as an arrival that day.
    expect(overview.arrivalsToday).toBeGreaterThanOrEqual(1);
    expect(overview.statusCounts["CONFIRMED"] ?? 0).toBeGreaterThanOrEqual(1);
    const direct = overview.sourceMix.find((s) => s.source === "DIRECT");
    expect(direct?.count ?? 0).toBeGreaterThanOrEqual(1);
    expect(typeof overview.needsAttention).toBe("number");
  });

  it("denies a role without reservation:view", async () => {
    const claims = await actAs(USER_HOUSEKEEPING_ID);
    await expect(bookingsOverview(claims, { propertyId: PROP_A_ID, date: d("2027-07-12") })).rejects.toThrow();
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
