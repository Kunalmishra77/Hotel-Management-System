/**
 * 14 analytics integration — T-6..T-16 (FR-2/5/6/7/8/14/16, AC-3/6/7/8/9/11/13).
 * Night-audit orchestration + idempotency + concurrency + permission-filtered
 * tiles + trend. Auth mocked at the boundary.
 */
import { vi } from "vitest";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { createPrismaClient } from "@/lib/db/client";
import type { SessionClaims } from "@/lib/auth/claims";

vi.mock("@/lib/auth", () => ({ requireUser: async () => { throw new Error("unused"); } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

import { PROP_A_ID, ROOM_101_ID, GUEST_RAVI_ID, USER_MANAGER_ID, USER_RECEPTION_A_ID } from "../../prisma/seed/fixtures";
import { resetRoomsA } from "../../prisma/seed/01-property";
import { assembleClaims } from "@/lib/auth/claims";
import { runNightAudit } from "@/features/analytics/night-audit";
import { liveTiles, trend } from "@/features/analytics/queries";

const prisma = createPrismaClient();
// A run-unique base so persistent (append-only) folio lines from a prior run
// never land on the same business date and inflate this run's room revenue.
const RUN_BASE = Date.UTC(2029, 0, 1) + (Date.now() % 2000) * 86_400_000;
let dayCounter = 0;
const createdReservations: string[] = [];
const usedDates: Date[] = [];

async function claims(userId: string): Promise<SessionClaims> {
  const c = await assembleClaims(prisma, userId);
  if (!c) throw new Error("no claims");
  return c;
}

/** An IN_HOUSE stay on ROOM_101 for a unique future business date. Returns the date. */
async function inHouseStay(): Promise<Date> {
  const start = new Date(RUN_BASE + dayCounter * 3 * 86_400_000);
  const end = new Date(RUN_BASE + (dayCounter * 3 + 1) * 86_400_000);
  dayCounter += 1;
  usedDates.push(start);
  const r = await prisma.reservation.create({
    data: { propertyId: PROP_A_ID, code: `NA14-${Date.now()}-${dayCounter}`, guestId: GUEST_RAVI_ID, status: "IN_HOUSE", source: "WALK_IN", checkInDate: start, checkOutDate: end, checkInAt: start, nights: 1, ratePaise: 400_000 },
    select: { id: true },
  });
  createdReservations.push(r.id);
  await prisma.roomAllocation.create({ data: { propertyId: PROP_A_ID, reservationId: r.id, roomId: ROOM_101_ID, startDate: start, endDate: end } });
  await prisma.folio.create({ data: { propertyId: PROP_A_ID, kind: "RESERVATION", reservationId: r.id } });
  return start;
}

afterEach(async () => {
  // Check out the test reservations so a later night audit doesn't re-charge them.
  if (createdReservations.length) {
    await prisma.reservation.updateMany({ where: { id: { in: createdReservations } }, data: { status: "CHECKED_OUT" } });
    await prisma.roomAllocation.deleteMany({ where: { reservationId: { in: createdReservations } } });
    createdReservations.length = 0;
  }
  for (const d of usedDates) {
    await prisma.dailyStatSnapshot.deleteMany({ where: { propertyId: PROP_A_ID, businessDate: d } });
    await prisma.nightAuditRun.deleteMany({ where: { propertyId: PROP_A_ID, businessDate: d } });
  }
  usedDates.length = 0;
  await prisma.property.update({ where: { id: PROP_A_ID }, data: { currentBusinessDate: null } });
  // The night audit's markNoShows can flip statuses on leftover reservations and
  // free their rooms — restore ROOMS-A so downstream room/property tests see the
  // seeded composition.
  await resetRoomsA(prisma);
});
afterAll(async () => { await prisma.$disconnect(); });

describe("runNightAudit (T-6/8/9, AC-7/9)", () => {
  it("posts room-nights, snapshots occupancy/revenue, rolls the date, emits", async () => {
    const date = await inHouseStay();
    const res = await runNightAudit(PROP_A_ID, date);
    expect(res.status).toBe("COMPLETED");

    const snap = await prisma.dailyStatSnapshot.findUniqueOrThrow({ where: { propertyId_businessDate: { propertyId: PROP_A_ID, businessDate: date } } });
    expect(snap.occupiedRoomNights).toBe(1);          // one in-house allocation over the date
    expect(Number(snap.roomRevenuePaise)).toBe(400_000); // ₹4,000 room-night posted by 06
    expect(snap.availableRoomNights).toBe(9);          // 10 active − 1 seeded maintenance room
    expect(snap.adrPaise).toBe(400_000);

    const prop = await prisma.property.findUniqueOrThrow({ where: { id: PROP_A_ID } });
    expect(prop.currentBusinessDate?.toISOString().slice(0, 10)).toBe(new Date(date.getTime() + 86_400_000).toISOString().slice(0, 10));
    expect(await prisma.domainEvent.findFirst({ where: { type: "NightAuditCompleted", aggregateId: PROP_A_ID } })).not.toBeNull();
  });

  it("is idempotent — a re-run returns ALREADY_RUN, no second snapshot (AC-8)", async () => {
    const date = await inHouseStay();
    await runNightAudit(PROP_A_ID, date);
    const again = await runNightAudit(PROP_A_ID, date);
    expect(again.status).toBe("ALREADY_RUN");
    expect(await prisma.dailyStatSnapshot.count({ where: { propertyId: PROP_A_ID, businessDate: date } })).toBe(1);
  });

  it("under concurrency, exactly one run completes (AC-11)", async () => {
    const date = await inHouseStay();
    const [a, b] = await Promise.all([runNightAudit(PROP_A_ID, date), runNightAudit(PROP_A_ID, date)]);
    const outcomes = [a.status, b.status].sort();
    expect(outcomes.filter((s) => s === "COMPLETED")).toHaveLength(1);
    expect(await prisma.dailyStatSnapshot.count({ where: { propertyId: PROP_A_ID, businessDate: date } })).toBe(1);
  });
});

describe("live tiles + trend (T-12/13/16, AC-6/13)", () => {
  it("hides financial tiles from a non-financial role, keeps operational (AC-6)", async () => {
    const rec = await liveTiles(await claims(USER_RECEPTION_A_ID), [PROP_A_ID]);
    expect(rec.rooms).toBeDefined();          // operational tiles present
    expect(rec.revenueTodayPaise).toBeNull(); // financial hidden

    const mgr = await liveTiles(await claims(USER_MANAGER_ID), [PROP_A_ID]);
    expect(mgr.revenueTodayPaise).not.toBeNull(); // manager sees money
  });

  it("trend reads closed-date snapshots (AC-13)", async () => {
    const date = await inHouseStay();
    await runNightAudit(PROP_A_ID, date);
    const points = await trend(await claims(USER_MANAGER_ID), { metric: "occupancy", from: date, to: date, propertyIds: [PROP_A_ID] });
    expect(points).toHaveLength(1);
    expect(points[0]!.value).toBeGreaterThan(0); // occupancy bps recorded
  });
});
