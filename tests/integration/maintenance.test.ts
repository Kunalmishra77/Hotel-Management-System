/**
 * 11 maintenance integration — T-5/6/7/8/9 (FR-1..7, AC-1/3/4/5/6/7/8).
 * Auth mocked at the boundary. Room block ↔ reservation invariant is the crux.
 */
import { vi } from "vitest";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPrismaClient } from "@/lib/db/client";
import type { SessionClaims } from "@/lib/auth/claims";

const authMock = vi.hoisted(() => ({ current: null as SessionClaims | null }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => { if (!authMock.current) throw new Error("no user"); return authMock.current; } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

import { PROP_A_ID, ROOM_103_ID, GUEST_RAVI_ID, USER_MAINTENANCE_ID, USER_RECEPTION_A_ID } from "../../prisma/seed/fixtures";
import { assembleClaims } from "@/lib/auth/claims";
import { createJob, startJob, closeJob, blockRoomForJob } from "@/features/maintenance/actions";
import { runPreventiveReminders } from "@/features/maintenance/jobs";
import { maintenanceOverview } from "@/features/maintenance/queries";

const prisma = createPrismaClient();
const jobIds: string[] = [];
const reservationIds: string[] = [];

async function actAs(userId: string): Promise<SessionClaims> {
  const c = await assembleClaims(prisma, userId);
  if (!c) throw new Error("no claims");
  authMock.current = c;
  return c;
}
function track(r: { ok: boolean; data?: { jobId: string } }) { if (r.ok && r.data) jobIds.push(r.data.jobId); }

beforeEach(() => { authMock.current = null; });
afterEach(async () => {
  await prisma.maintenanceJob.deleteMany({ where: { id: { in: jobIds } } });
  await prisma.roomBlock.deleteMany({ where: { roomId: ROOM_103_ID } });
  if (reservationIds.length) {
    await prisma.roomAllocation.deleteMany({ where: { reservationId: { in: reservationIds } } });
    await prisma.reservation.deleteMany({ where: { id: { in: reservationIds } } });
  }
  jobIds.length = 0; reservationIds.length = 0;
});
afterAll(async () => { await prisma.$disconnect(); });

describe("createJob + RBAC (T-5/T-9, AC-1/7)", () => {
  it("creates an OPEN job + MaintenanceJobCreated + audit (AC-1)", async () => {
    await actAs(USER_MAINTENANCE_ID);
    const res = await createJob({ propertyId: PROP_A_ID, roomId: ROOM_103_ID, category: "AC", description: "AC not cooling", priority: "HIGH" });
    track(res);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const job = await prisma.maintenanceJob.findUniqueOrThrow({ where: { id: res.data.jobId } });
    expect(job.status).toBe("OPEN");
    expect(job.priority).toBe("HIGH");
    expect(await prisma.domainEvent.findFirst({ where: { type: "MaintenanceJobCreated", aggregateId: res.data.jobId } })).not.toBeNull();
  });

  it("denies Reception (no maintenance:manage) → FORBIDDEN (AC-7)", async () => {
    await actAs(USER_RECEPTION_A_ID);
    const res = await createJob({ propertyId: PROP_A_ID, roomId: ROOM_103_ID, category: "AC", description: "x" });
    track(res);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("FORBIDDEN");
  });
});

describe("block room for job (T-6, AC-3/8)", () => {
  it("blocks a free room and links the block (AC-3)", async () => {
    await actAs(USER_MAINTENANCE_ID);
    const job = await createJob({ propertyId: PROP_A_ID, roomId: ROOM_103_ID, category: "AC", description: "AC" });
    track(job);
    if (!job.ok) throw new Error("create failed");
    const res = await blockRoomForJob({ jobId: job.data.jobId, startDate: "2028-03-14", endDate: "2028-03-16" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const block = await prisma.roomBlock.findUniqueOrThrow({ where: { id: res.data.roomBlockId } });
    expect(block.roomId).toBe(ROOM_103_ID);
    expect((await prisma.maintenanceJob.findUniqueOrThrow({ where: { id: job.data.jobId } })).roomBlockId).toBe(res.data.roomBlockId);
  });

  it("refuses to block over a confirmed reservation (AC-8)", async () => {
    // A confirmed reservation holds R-103 for 10–12 Apr.
    const reservation = await prisma.reservation.create({
      data: { propertyId: PROP_A_ID, code: `MNT-${Date.now()}`, guestId: GUEST_RAVI_ID, status: "CONFIRMED", source: "WALK_IN", checkInDate: new Date("2028-04-10"), checkOutDate: new Date("2028-04-12"), nights: 2, ratePaise: 400_000 },
      select: { id: true },
    });
    reservationIds.push(reservation.id);
    await prisma.roomAllocation.create({ data: { propertyId: PROP_A_ID, reservationId: reservation.id, roomId: ROOM_103_ID, startDate: new Date("2028-04-10"), endDate: new Date("2028-04-12") } });

    await actAs(USER_MAINTENANCE_ID);
    const job = await createJob({ propertyId: PROP_A_ID, roomId: ROOM_103_ID, category: "AC", description: "AC" });
    track(job);
    if (!job.ok) throw new Error("create failed");
    const res = await blockRoomForJob({ jobId: job.data.jobId, startDate: "2028-04-10", endDate: "2028-04-12" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("ROOM_HAS_RESERVATION");
    expect(await prisma.roomBlock.count({ where: { roomId: ROOM_103_ID } })).toBe(0); // nothing blocked
  });
});

describe("lifecycle (T-7, AC-4/5)", () => {
  it("start → close with cost unblocks the room + emits MaintenanceJobClosed (AC-4)", async () => {
    await actAs(USER_MAINTENANCE_ID);
    const job = await createJob({ propertyId: PROP_A_ID, roomId: ROOM_103_ID, category: "AC", description: "AC" });
    track(job);
    if (!job.ok) throw new Error("create failed");
    await blockRoomForJob({ jobId: job.data.jobId, startDate: "2028-06-01", endDate: "2028-06-03" });
    await startJob({ jobId: job.data.jobId });
    const res = await closeJob({ jobId: job.data.jobId, costPaise: 150_000 });
    expect(res.ok).toBe(true);
    const closed = await prisma.maintenanceJob.findUniqueOrThrow({ where: { id: job.data.jobId } });
    expect(closed.status).toBe("CLOSED");
    expect(closed.closedAt).not.toBeNull();
    expect(closed.costPaise).toBe(150_000);
    expect(await prisma.roomBlock.count({ where: { roomId: ROOM_103_ID } })).toBe(0); // unblocked on close
    expect(await prisma.domainEvent.findFirst({ where: { type: "MaintenanceJobClosed", aggregateId: job.data.jobId } })).not.toBeNull();
  });

  it("rejects reopening a CLOSED job (AC-5)", async () => {
    await actAs(USER_MAINTENANCE_ID);
    const job = await createJob({ propertyId: PROP_A_ID, roomId: ROOM_103_ID, category: "AC", description: "AC" });
    track(job);
    if (!job.ok) throw new Error("create failed");
    await closeJob({ jobId: job.data.jobId });
    const res = await startJob({ jobId: job.data.jobId }); // CLOSED → IN_PROGRESS illegal
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("ILLEGAL_TRANSITION");
  });
});

describe("maintenanceOverview (board summary)", () => {
  it("returns numeric status counts and denies without maintenance:manage", async () => {
    const m = await actAs(USER_MAINTENANCE_ID);
    const o = await maintenanceOverview(m, PROP_A_ID);
    expect(typeof o.open).toBe("number");
    expect(typeof o.preventiveDue).toBe("number");
    expect(o.open + o.inProgress + o.closed).toBeGreaterThanOrEqual(0);

    const r = await actAs(USER_RECEPTION_A_ID);
    await expect(maintenanceOverview(r, PROP_A_ID)).rejects.toThrow();
  });
});

describe("preventive reminders (T-8, AC-6)", () => {
  it("fires MaintenanceScheduled within the lead window and recurs", async () => {
    await actAs(USER_MAINTENANCE_ID);
    const now = new Date("2028-09-10T00:00:00Z");
    const job = await createJob({ propertyId: PROP_A_ID, category: "PEST_CONTROL", description: "Pest control", isPreventive: true, scheduledFor: "2028-09-12", recurrence: "monthly" });
    track(job);
    if (!job.ok) throw new Error("create failed");

    const out = await runPreventiveReminders(now); // 12th is within 3 days of the 10th
    expect(out.reminded).toBeGreaterThanOrEqual(1);
    expect(await prisma.domainEvent.findFirst({ where: { type: "MaintenanceScheduled", aggregateId: job.data.jobId } })).not.toBeNull();
    // Recurred: scheduledFor advanced ~1 month.
    const advanced = await prisma.maintenanceJob.findUniqueOrThrow({ where: { id: job.data.jobId } });
    expect(advanced.scheduledFor?.toISOString().slice(0, 10)).toBe("2028-10-12");

    // A second run does nothing (no longer in the window).
    const again = await runPreventiveReminders(now);
    expect(again.reminded).toBe(0);
  });
});
