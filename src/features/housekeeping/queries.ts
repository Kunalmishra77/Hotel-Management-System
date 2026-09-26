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

export type HousekeepingPropertyRow = {
  propertyId: string;
  propertyName: string;
  toClean: number;
  inProgress: number;
  complaints: number;
};

/**
 * Cross-property housekeeping rollup for the all-hotels landing (Phase-3 ⑨) — rooms
 * to clean, in-progress and open complaints per property across the caller's
 * accessible set, so the overview shows where attention is needed before drilling
 * in. Property-scoped grouped counts; no PII/financials (operational role).
 */
export async function housekeepingPortfolio(
  user: SessionClaims,
  propertyIds: string[],
): Promise<HousekeepingPropertyRow[]> {
  const ids = propertyIds.filter((id) => user.accessiblePropertyIds.includes(id));
  if (ids.length === 0) return [];
  const scoped = db.scoped(user);
  const [statusGroups, complaintGroups, props] = await Promise.all([
    scoped.housekeepingTask.groupBy({ by: ["propertyId", "status"], where: { propertyId: { in: ids } }, _count: { _all: true } }),
    scoped.housekeepingTask.groupBy({ by: ["propertyId"], where: { propertyId: { in: ids }, complaintText: { not: null } }, _count: { _all: true } }),
    db.unscoped().property.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }),
  ]);
  const nameById = new Map(props.map((p) => [p.id, p.name]));
  const complaintById = new Map(complaintGroups.map((g) => [g.propertyId, g._count._all]));
  const count = (pid: string, status: string) =>
    statusGroups.find((g) => g.propertyId === pid && (g.status as string) === status)?._count._all ?? 0;
  return ids
    .map((id) => ({
      propertyId: id,
      propertyName: nameById.get(id) ?? id,
      toClean: count(id, "PENDING"),
      inProgress: count(id, "IN_PROGRESS"),
      complaints: complaintById.get(id) ?? 0,
    }))
    .sort((a, b) => b.toClean + b.complaints - (a.toClean + a.complaints));
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
