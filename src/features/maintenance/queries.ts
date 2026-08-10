/**
 * Maintenance queries — 11 (FR-1/4). Job list by status/priority + preventive
 * schedule. Callers pass claims.
 */
import { db } from "@/lib/db";
import { authorize } from "@/lib/permissions";
import type { SessionClaims } from "@/lib/auth/claims";

/**
 * Maintenance board summary — open/in-progress/closed job counts, urgent load
 * (URGENT+HIGH still open), preventive jobs due within the lead window, and rooms
 * currently blocked out-of-order for a job (the maintenance↔rooms link, visible).
 * Property-scoped grouped counts.
 */
export type MaintenanceOverview = {
  open: number;
  inProgress: number;
  closed: number;
  urgent: number;
  preventiveDue: number;
  roomsBlocked: number;
};

const PREVENTIVE_LEAD_DAYS = 7;

export async function maintenanceOverview(user: SessionClaims, propertyId: string): Promise<MaintenanceOverview> {
  authorize(user, "maintenance:manage", propertyId);
  const scoped = db.scoped(user);
  const where = { propertyId };
  const dueBy = new Date(Date.now() + PREVENTIVE_LEAD_DAYS * 86_400_000);
  const [statusGroups, urgent, preventiveDue, roomsBlocked] = await Promise.all([
    scoped.maintenanceJob.groupBy({ by: ["status"], where, _count: { _all: true } }),
    scoped.maintenanceJob.count({ where: { ...where, status: { in: ["OPEN", "IN_PROGRESS"] }, priority: { in: ["URGENT", "HIGH"] } } }),
    scoped.maintenanceJob.count({ where: { ...where, isPreventive: true, status: { not: "CLOSED" }, scheduledFor: { lte: dueBy } } }),
    scoped.maintenanceJob.count({ where: { ...where, status: { not: "CLOSED" }, roomBlockId: { not: null } } }),
  ]);
  const c = (s: string) => statusGroups.find((g) => (g.status as string) === s)?._count._all ?? 0;
  return { open: c("OPEN"), inProgress: c("IN_PROGRESS"), closed: c("CLOSED"), urgent, preventiveDue, roomsBlocked };
}

export type MaintenanceJobItem = {
  id: string;
  roomId: string | null;
  roomNumber: string | null;
  category: string;
  description: string;
  status: string;
  priority: string;
  costPaise: number | null;
  isPreventive: boolean;
  scheduledFor: Date | null;
  hasBlock: boolean;
};

export async function listJobs(
  user: SessionClaims,
  input: { propertyId: string; status?: string },
): Promise<MaintenanceJobItem[]> {
  const jobs = await db.scoped(user).maintenanceJob.findMany({
    where: { propertyId: input.propertyId, ...(input.status ? { status: input.status as never } : {}) },
    select: { id: true, roomId: true, category: true, description: true, status: true, priority: true, costPaise: true, isPreventive: true, scheduledFor: true, roomBlockId: true },
    orderBy: [{ status: "asc" }, { priority: "desc" }, { createdAt: "desc" }],
    take: 200,
  });
  const roomIds = [...new Set(jobs.map((j) => j.roomId).filter((r): r is string => r !== null))];
  const rooms = roomIds.length ? await db.scoped(user).room.findMany({ where: { id: { in: roomIds } }, select: { id: true, number: true } }) : [];
  const numberOf = new Map(rooms.map((r) => [r.id, r.number]));

  return jobs.map((j) => ({
    id: j.id, roomId: j.roomId, roomNumber: j.roomId ? (numberOf.get(j.roomId) ?? null) : null,
    category: j.category, description: j.description, status: j.status, priority: j.priority,
    costPaise: j.costPaise, isPreventive: j.isPreventive, scheduledFor: j.scheduledFor, hasBlock: j.roomBlockId !== null,
  }));
}

/** Upcoming preventive jobs (schedule view). */
export async function preventiveSchedule(user: SessionClaims, propertyId: string): Promise<MaintenanceJobItem[]> {
  const all = await listJobs(user, { propertyId });
  return all.filter((j) => j.isPreventive).sort((a, b) => (a.scheduledFor?.getTime() ?? 0) - (b.scheduledFor?.getTime() ?? 0));
}
