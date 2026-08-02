/**
 * 10 housekeeping integration — T-5/6/7/8 (FR-3/4/5/6/8, AC-1/2/3/5/6/8).
 * The offline conflict path is the crux. Auth mocked at the boundary.
 */
import { vi } from "vitest";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPrismaClient } from "@/lib/db/client";
import type { SessionClaims } from "@/lib/auth/claims";

const authMock = vi.hoisted(() => ({ current: null as SessionClaims | null }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => { if (!authMock.current) throw new Error("no user"); return authMock.current; } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

import { PROP_A_ID, ROOM_101_ID, ORG_ID, USER_HOUSEKEEPING_ID, USER_MAINTENANCE_ID } from "../../prisma/seed/fixtures";
import { resetRoomsA } from "../../prisma/seed/01-property";
import { assembleClaims } from "@/lib/auth/claims";
import { updateTaskStatus, recordHousekeepingDetails, syncOfflineUpdates } from "@/features/housekeeping/actions";
import { housekeepingConsumer } from "@/features/housekeeping/consumer";

const prisma = createPrismaClient();

async function actAs(userId: string): Promise<SessionClaims> {
  const c = await assembleClaims(prisma, userId);
  if (!c) throw new Error("no claims");
  authMock.current = c;
  return c;
}
async function freshTask(serverStatusChangedAt?: Date): Promise<string> {
  const t = await prisma.housekeepingTask.create({
    data: { propertyId: PROP_A_ID, roomId: ROOM_101_ID, type: "CLEANING", status: "PENDING", serverStatusChangedAt: serverStatusChangedAt ?? null },
    select: { id: true },
  });
  return t.id;
}
async function roomTo(status: "VACANT" | "OCCUPIED" | "HOUSEKEEPING") {
  await prisma.room.update({ where: { id: ROOM_101_ID }, data: { status } });
}

beforeEach(() => { authMock.current = null; });
afterEach(async () => {
  await prisma.housekeepingTask.deleteMany({ where: { roomId: ROOM_101_ID } });
  await prisma.maintenanceJob.deleteMany({ where: { roomId: ROOM_101_ID } });
  await resetRoomsA(prisma);
});
afterAll(async () => { await prisma.$disconnect(); });

describe("consumer: room → HOUSEKEEPING creates a task (AC-1)", () => {
  it("creates a PENDING cleaning task, idempotently", async () => {
    const env = { id: "e1", seq: 1n, type: "RoomStatusChanged", orgId: ORG_ID, propertyId: PROP_A_ID, aggregateId: ROOM_101_ID, payload: { to: "HOUSEKEEPING" }, occurredAt: new Date() };
    await housekeepingConsumer.handle(env);
    await housekeepingConsumer.handle({ ...env, id: "e2" }); // re-delivery
    const tasks = await prisma.housekeepingTask.findMany({ where: { roomId: ROOM_101_ID, status: "PENDING" } });
    expect(tasks).toHaveLength(1);
  });
});

describe("mark clean → room VACANT (T-5, AC-2)", () => {
  it("DONE frees the room via 02 and emits HousekeepingTaskDone", async () => {
    await roomTo("HOUSEKEEPING");
    const taskId = await freshTask();
    await actAs(USER_HOUSEKEEPING_ID);
    const res = await updateTaskStatus({ taskId, status: "DONE" });
    expect(res.ok).toBe(true);
    expect((await prisma.room.findUniqueOrThrow({ where: { id: ROOM_101_ID } })).status).toBe("VACANT");
    expect((await prisma.housekeepingTask.findUniqueOrThrow({ where: { id: taskId } })).status).toBe("DONE");
    expect(await prisma.domainEvent.findFirst({ where: { type: "HousekeepingTaskDone", aggregateId: taskId } })).not.toBeNull();
  });
});

describe("record details → maintenance job (T-6, AC-3)", () => {
  it("stores linen/towel + complaint and raises an 11 job", async () => {
    const taskId = await freshTask();
    await actAs(USER_HOUSEKEEPING_ID);
    const res = await recordHousekeepingDetails({ taskId, linenChanged: true, towelChanged: true, complaint: "AC not cooling", maintenanceCategory: "AC" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.maintenanceJobId).not.toBeNull();
    const task = await prisma.housekeepingTask.findUniqueOrThrow({ where: { id: taskId } });
    expect(task.linenChanged).toBe(true);
    expect(task.complaintText).toBe("AC not cooling");
    expect(task.raisedMaintenanceJobId).toBe(res.data.maintenanceJobId);
    const job = await prisma.maintenanceJob.findUniqueOrThrow({ where: { id: res.data.maintenanceJobId! } });
    expect(job.category).toBe("AC");
    expect(job.roomId).toBe(ROOM_101_ID);
  });
});

describe("offline sync + conflict (T-7, AC-5/6)", () => {
  it("applies a fresh queued update", async () => {
    const taskId = await freshTask(new Date("2026-07-12T09:00:00Z"));
    await actAs(USER_HOUSEKEEPING_ID);
    const res = await syncOfflineUpdates({ updates: [{ taskId, status: "IN_PROGRESS", clientUpdatedAt: "2026-07-12T10:00:00Z" }] });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.applied).toContain(taskId);
    expect(res.data.conflicts).toHaveLength(0);
    expect((await prisma.housekeepingTask.findUniqueOrThrow({ where: { id: taskId } })).status).toBe("IN_PROGRESS");
  });

  it("rejects a STALE offline clean (client predates the room's re-occupation) (AC-6)", async () => {
    // The task's server clock advanced to 10:00 (room re-occupied); the offline
    // write was made at 09:00 → stale, must not apply.
    const taskId = await freshTask(new Date("2026-07-12T10:00:00Z"));
    await actAs(USER_HOUSEKEEPING_ID);
    const res = await syncOfflineUpdates({ updates: [{ taskId, status: "DONE", clientUpdatedAt: "2026-07-12T09:00:00Z" }] });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.applied).toHaveLength(0);
    expect(res.data.conflicts[0]).toMatchObject({ taskId, reason: "SYNC_CONFLICT" });
    // Server state untouched — still PENDING, room not freed.
    expect((await prisma.housekeepingTask.findUniqueOrThrow({ where: { id: taskId } })).status).toBe("PENDING");
  });
});

describe("RBAC (T-8, AC-8)", () => {
  it("denies a role without housekeeping:update (Maintenance)", async () => {
    const taskId = await freshTask();
    await actAs(USER_MAINTENANCE_ID);
    const res = await updateTaskStatus({ taskId, status: "IN_PROGRESS" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("FORBIDDEN");
  });
});
