/**
 * 05 guest-history integration — T-5/5b/6/7/8 (FR-2/2b/5/6, AC-3/4/6/7/8/9/10/11).
 * Snapshot is a derived cache: recompute is idempotent and reconciles with 06 to
 * the paisa. Auth mocked at the boundary; billing rows are append-only, so each
 * test uses a fresh guest.
 */
import { vi } from "vitest";
import { afterAll, describe, expect, it } from "vitest";
import { createPrismaClient } from "@/lib/db/client";
import type { SessionClaims } from "@/lib/auth/claims";

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

import { ORG_ID, PROP_A_ID, ROOM_101_ID, CAT_DLX_ID, USER_MANAGER_ID, USER_RECEPTION_A_ID } from "../../prisma/seed/fixtures";
import { assembleClaims } from "@/lib/auth/claims";
import { recomputeGuestStats, reconcileGuestStats } from "@/features/guest-history/recompute";
import { getGuestHistory } from "@/features/guest-history/queries";
import { guestHistoryConsumer } from "@/features/guest-history/consumer";

const prisma = createPrismaClient();

// Room allocations are NOT append-only — clean them up so this test never leaks
// ROOM_101 allocations that would pollute other suites' availability/counts.
// (Folios/lines are append-only and stay; they don't affect room availability.)
afterAll(async () => {
  await prisma.roomAllocation.deleteMany({ where: { reservation: { code: { startsWith: "GH-" } } } });
  await prisma.$disconnect();
});

// Each seeded stay gets a UNIQUE date range on ROOM_101 — the 03 `room_no_overlap`
// exclusion constraint forbids two allocations on the same room+overlapping dates.
let stayCounter = 0;

/** A fresh guest with one CHECKED_OUT Deluxe stay, folio charged ₹4,000 + 12%, paid in full. */
async function seedGuestWithStay(suffix: string, opts: { paid?: boolean; refund?: boolean } = {}) {
  const guestId = `gh_${suffix}_${Date.now()}`;
  const start = new Date(Date.UTC(2027, 0, 1 + stayCounter * 3));
  const end = new Date(Date.UTC(2027, 0, 3 + stayCounter * 3));
  stayCounter += 1;
  await prisma.guest.create({ data: { id: guestId, orgId: ORG_ID, fullName: `GH ${suffix}`, mobile: "enc" } });
  const reservation = await prisma.reservation.create({
    data: {
      propertyId: PROP_A_ID, code: `GH-${suffix}-${Date.now()}`, guestId, status: "CHECKED_OUT",
      source: "WALK_IN", checkInDate: start, checkOutDate: end,
      checkOutAt: end, nights: 2, ratePaise: 400_000,
    },
    select: { id: true },
  });
  await prisma.roomAllocation.create({ data: { propertyId: PROP_A_ID, reservationId: reservation.id, roomId: ROOM_101_ID, startDate: start, endDate: end } });
  const folio = await prisma.folio.create({ data: { propertyId: PROP_A_ID, kind: "RESERVATION", reservationId: reservation.id }, select: { id: true } });
  await prisma.folioLine.create({ data: { folioId: folio.id, type: "ROOM", description: "Room", quantity: 1, unitPaise: 400_000, amountPaise: 400_000n, taxRateBps: 1200, cgstPaise: 24_000, sgstPaise: 24_000, placeOfSupplyState: "Karnataka", businessDate: start } });
  if (opts.paid) await prisma.payment.create({ data: { propertyId: PROP_A_ID, folioId: folio.id, mode: "CASH", amountPaise: 448_000n } });
  if (opts.refund) await prisma.payment.create({ data: { propertyId: PROP_A_ID, folioId: folio.id, mode: "CASH", amountPaise: 100_000n, isRefund: true } });
  return { guestId, folioId: folio.id, reservationId: reservation.id };
}

async function claims(userId: string): Promise<SessionClaims> {
  const c = await assembleClaims(prisma, userId);
  if (!c) throw new Error("no claims");
  return c;
}

describe("recompute (T-3/5/6, AC-1/3/7)", () => {
  it("derives visits/nights/preferred + revenue from 06, reconciling to the paisa", async () => {
    const { guestId } = await seedGuestWithStay("basic", { paid: true });
    await recomputeGuestStats(ORG_ID, guestId);
    const s = await prisma.guestStatsSnapshot.findUniqueOrThrow({ where: { guestId } });
    expect(s.visits).toBe(1);
    expect(s.totalRoomNights).toBe(2);
    expect(Number(s.totalRevenuePaise)).toBe(400_000); // ROOM taxable, tax-excluded
    expect(Number(s.outstandingPaise)).toBe(0); // 448,000 charged, 448,000 paid
    expect(s.preferredCategoryId).toBe(CAT_DLX_ID);
    expect(s.lastStayAt).not.toBeNull();
  });

  it("is idempotent — recompute twice yields the same numbers (AC-10)", async () => {
    const { guestId } = await seedGuestWithStay("idem", { paid: true });
    await recomputeGuestStats(ORG_ID, guestId);
    await recomputeGuestStats(ORG_ID, guestId);
    const s = await prisma.guestStatsSnapshot.findUniqueOrThrow({ where: { guestId } });
    expect(s.visits).toBe(1); // not 2
    expect(Number(s.totalRevenuePaise)).toBe(400_000);
  });

  it("a refund raises outstanding back (reconciles with 06, AC-9)", async () => {
    const { guestId } = await seedGuestWithStay("refund", { paid: true, refund: true });
    await recomputeGuestStats(ORG_ID, guestId);
    const s = await prisma.guestStatsSnapshot.findUniqueOrThrow({ where: { guestId } });
    // 448,000 charged − (448,000 − 100,000 refunded) = 100,000 owed again.
    expect(Number(s.outstandingPaise)).toBe(100_000);
  });
});

describe("event consumer (T-5/5b, AC-3/8)", () => {
  it("recomputes on a folio event resolved via the reservation", async () => {
    const { guestId, folioId } = await seedGuestWithStay("evt", { paid: true });
    await guestHistoryConsumer.handle({ id: "e1", seq: 1n, type: "FolioCharged", orgId: ORG_ID, propertyId: PROP_A_ID, aggregateId: folioId, payload: {}, occurredAt: new Date() });
    const s = await prisma.guestStatsSnapshot.findUniqueOrThrow({ where: { guestId } });
    expect(s.visits).toBe(1);
  });

  it("GuestMerged recomputes BOTH survivor and loser (AC-8)", async () => {
    const survivor = await seedGuestWithStay("surv", { paid: true });
    const loser = await seedGuestWithStay("lose", { paid: true });
    // Simulate 04's merge having re-pointed the loser's reservation to the survivor.
    await prisma.reservation.updateMany({ where: { guestId: loser.guestId }, data: { guestId: survivor.guestId } });

    await guestHistoryConsumer.handle({ id: "e2", seq: 2n, type: "GuestMerged", orgId: ORG_ID, propertyId: null, aggregateId: survivor.guestId, payload: { loserId: loser.guestId }, occurredAt: new Date() });

    const surv = await prisma.guestStatsSnapshot.findUniqueOrThrow({ where: { guestId: survivor.guestId } });
    const lose = await prisma.guestStatsSnapshot.findUniqueOrThrow({ where: { guestId: loser.guestId } });
    expect(surv.visits).toBe(2); // absorbed both stays
    expect(lose.visits).toBe(0); // zeroed
  });
});

describe("reconcile (T-6, AC-4/11)", () => {
  it("recomputes from source when the cache has drifted", async () => {
    const { guestId } = await seedGuestWithStay("drift", { paid: true });
    // Corrupt the cache.
    await prisma.guestStatsSnapshot.upsert({
      where: { guestId }, create: { guestId, visits: 99, totalRevenuePaise: 9_999_999n },
      update: { visits: 99, totalRevenuePaise: 9_999_999n },
    });
    await reconcileGuestStats(ORG_ID, guestId);
    const s = await prisma.guestStatsSnapshot.findUniqueOrThrow({ where: { guestId } });
    expect(s.visits).toBe(1); // source wins
    expect(Number(s.totalRevenuePaise)).toBe(400_000);
  });
});

describe("getGuestHistory permission masking (T-7, AC-5/6)", () => {
  it("hides financials from a non-financial role, keeps stay counts (AC-6)", async () => {
    const { guestId } = await seedGuestWithStay("perm", { paid: true });
    await recomputeGuestStats(ORG_ID, guestId);

    const rec = await getGuestHistory(await claims(USER_RECEPTION_A_ID), guestId);
    expect(rec.visits).toBe(1); // counts visible
    expect(rec.totalRevenuePaise).toBeNull(); // money hidden

    const mgr = await getGuestHistory(await claims(USER_MANAGER_ID), guestId);
    expect(mgr.totalRevenuePaise).toBe(400_000); // manager sees money
    expect(mgr.bills.length).toBeGreaterThanOrEqual(0);
  });
});
