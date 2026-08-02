/**
 * Housekeeping queries — 10 (FR-2/3). Task board feed. Callers pass claims.
 * No financials/PII here — housekeeping is an operational role (FR-8).
 */
import { db } from "@/lib/db";
import type { SessionClaims } from "@/lib/auth/claims";

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
