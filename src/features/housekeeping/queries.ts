/**
 * Housekeeping queries — 10 (FR-2/3). Task board feed. Callers pass claims.
 * No financials/PII here — housekeeping is an operational role (FR-8).
 */
import { db } from "@/lib/db";
import { authorize } from "@/lib/permissions";
import type { SessionClaims } from "@/lib/auth/claims";

/**
 * Housekeeping board summary — the counts the landing needs at a glance: rooms to
 * clean, in-progress, done, open complaints, and how many tasks raised a
 * maintenance job (the housekeeping↔maintenance link, made visible). Grouped
 * counts, property-scoped, one round-trip.
 */
export type HousekeepingOverview = {
  toClean: number;
  inProgress: number;
  done: number;
  complaints: number;
  maintenanceRaised: number;
};

export async function housekeepingOverview(user: SessionClaims, propertyId: string): Promise<HousekeepingOverview> {
  authorize(user, "housekeeping:update", propertyId);
  const scoped = db.scoped(user);
  const where = { propertyId };
  const [statusGroups, complaints, maintenanceRaised] = await Promise.all([
    scoped.housekeepingTask.groupBy({ by: ["status"], where, _count: { _all: true } }),
    scoped.housekeepingTask.count({ where: { ...where, complaintText: { not: null } } }),
    scoped.housekeepingTask.count({ where: { ...where, raisedMaintenanceJobId: { not: null } } }),
  ]);
  const c = (s: string) => statusGroups.find((g) => (g.status as string) === s)?._count._all ?? 0;
  return { toClean: c("PENDING"), inProgress: c("IN_PROGRESS"), done: c("DONE"), complaints, maintenanceRaised };
}

export type HousekeepingTaskItem = {
  id: string;
  roomId: string;
  roomNumber: string;
  type: string;
  status: string;
  linenChanged: boolean;
  towelChanged: boolean;
  complaintText: string | null;
  hasMaintenanceJob: boolean;
};

export async function listTasks(user: SessionClaims, propertyId: string): Promise<HousekeepingTaskItem[]> {
  const tasks = await db.scoped(user).housekeepingTask.findMany({
    where: { propertyId },
    select: {
      id: true, roomId: true, type: true, status: true, linenChanged: true, towelChanged: true,
      complaintText: true, raisedMaintenanceJobId: true,
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  const roomIds = [...new Set(tasks.map((t) => t.roomId))];
  const rooms = await db.scoped(user).room.findMany({ where: { id: { in: roomIds } }, select: { id: true, number: true } });
  const numberOf = new Map(rooms.map((r) => [r.id, r.number]));

  return tasks.map((t) => ({
    id: t.id, roomId: t.roomId, roomNumber: numberOf.get(t.roomId) ?? "?",
    type: t.type, status: t.status, linenChanged: t.linenChanged, towelChanged: t.towelChanged,
    complaintText: t.complaintText, hasMaintenanceJob: t.raisedMaintenanceJobId !== null,
  }));
}
