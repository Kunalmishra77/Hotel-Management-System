/**
 * Maintenance queries — 11 (FR-1/4). Job list by status/priority + preventive
 * schedule. Callers pass claims.
 */
import { db } from "@/lib/db";
import type { SessionClaims } from "@/lib/auth/claims";

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
