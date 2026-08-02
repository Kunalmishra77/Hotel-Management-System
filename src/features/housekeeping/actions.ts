"use server";

/**
 * Housekeeping actions — 10 T-5/T-6/T-7 (FR-3..6, AC-2/3/4/5/6/8). `housekeeping:update`.
 *
 * Two integrity guards on a "mark clean": (1) `resolveConflict` rejects a STALE
 * offline write (client older than the task's authoritative server change), and
 * (2) 02's `changeRoomStatus` validates the transition — a room re-occupied
 * server-side refuses HOUSEKEEPING→VACANT. Never blind last-writer-wins.
 */
import { requireUser } from "@/lib/auth";
import { authorize } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import { emitEvent } from "@/lib/events";
import { DomainError, ErrorCode, NotFoundError } from "@/lib/errors";
import { toResult, type Result } from "@/lib/result";
import { changeRoomStatus } from "@/features/rooms/status-actions";
import { raiseMaintenanceJob, type MaintenanceCapableTx } from "@/features/maintenance";
import { resolveConflict } from "./domain/conflict";
import { hkDb, withHkContext } from "./internal";
import { updateTaskStatusSchema, recordDetailsSchema, syncSchema } from "./schema";
import type { SessionClaims } from "@/lib/auth/claims";

export type TaskResult = { id: string; status: string };

type LoadedTask = { id: string; propertyId: string; roomId: string; status: string; serverStatusChangedAt: Date | null };

async function loadTask(user: SessionClaims, taskId: string): Promise<LoadedTask> {
  const t = await hkDb(user).housekeepingTask.findFirst({
    where: { id: taskId },
    select: { id: true, propertyId: true, roomId: true, status: true, serverStatusChangedAt: true },
  });
  if (!t) throw new NotFoundError("Task not found.");
  return t;
}

/** Apply a status change to a task, with conflict + transition guards. Shared by the
 *  direct action and the offline sync path. Returns the new status. */
async function applyStatus(user: SessionClaims, task: LoadedTask, status: string, clientUpdatedAt?: Date): Promise<string> {
  // Guard 1: staleness (offline writes carry clientUpdatedAt).
  if (clientUpdatedAt) {
    const res = resolveConflict({ clientUpdatedAt }, { serverStatusChangedAt: task.serverStatusChangedAt });
    if (!res.apply) throw new DomainError(ErrorCode.SYNC_CONFLICT);
  }

  // Guard 2 (DONE only): 02 validates HOUSEKEEPING→VACANT; a re-occupied room refuses it.
  if (status === "DONE") {
    const moved = await changeRoomStatus({ roomId: task.roomId, to: "VACANT" });
    if (!moved.ok) throw new DomainError(moved.error.code as ErrorCode, moved.error.message);
  }

  return withHkContext(user, () =>
    hkDb(user).$transaction(async (tx) => {
      await tx.housekeepingTask.updateMany({
        where: { id: task.id },
        data: { status: status as never, serverStatusChangedAt: new Date() },
      });
      if (status === "DONE") {
        await emitEvent(tx, { type: "HousekeepingTaskDone", aggregateId: task.id, propertyId: task.propertyId, payload: { roomId: task.roomId } });
      }
      await writeAudit(tx, { action: "housekeeping:status", entityType: "HousekeepingTask", entityId: task.id, propertyId: task.propertyId, before: { status: task.status }, after: { status } });
      return status;
    }),
  );
}

/** Mark a task PENDING/IN_PROGRESS/DONE (FR-3, AC-2). DONE frees the room via 02. */
export async function updateTaskStatus(input: unknown): Promise<Result<TaskResult>> {
  return toResult(async () => {
    const data = updateTaskStatusSchema.parse(input);
    const user = await requireUser();
    const task = await loadTask(user, data.taskId);
    authorize(user, "housekeeping:update", task.propertyId);
    const status = await applyStatus(user, task, data.status, data.clientUpdatedAt);
    return { id: task.id, status };
  });
}

/** Record linen/towel + a complaint (FR-6, AC-3). A complaint raises an 11 job. */
export async function recordHousekeepingDetails(input: unknown): Promise<Result<{ id: string; maintenanceJobId: string | null }>> {
  return toResult(async () => {
    const data = recordDetailsSchema.parse(input);
    const user = await requireUser();
    const task = await loadTask(user, data.taskId);
    authorize(user, "housekeeping:update", task.propertyId);

    return withHkContext(user, () =>
      hkDb(user).$transaction(async (tx) => {
        let maintenanceJobId: string | null = null;
        if (data.complaint) {
          const { jobId } = await raiseMaintenanceJob(tx as unknown as MaintenanceCapableTx, {
            propertyId: task.propertyId, roomId: task.roomId,
            category: data.maintenanceCategory ?? "OTHER", description: data.complaint, reportedById: user.userId,
          });
          maintenanceJobId = jobId;
        }
        await tx.housekeepingTask.updateMany({
          where: { id: task.id },
          data: {
            ...(data.linenChanged !== undefined ? { linenChanged: data.linenChanged } : {}),
            ...(data.towelChanged !== undefined ? { towelChanged: data.towelChanged } : {}),
            ...(data.complaint !== undefined ? { complaintText: data.complaint } : {}),
            ...(maintenanceJobId ? { raisedMaintenanceJobId: maintenanceJobId } : {}),
          },
        });
        await writeAudit(tx, { action: "housekeeping:details", entityType: "HousekeepingTask", entityId: task.id, propertyId: task.propertyId, after: { linen: data.linenChanged, towel: data.towelChanged, complaint: Boolean(data.complaint), maintenanceJobId } });
        return { id: task.id, maintenanceJobId };
      }),
    );
  });
}

export type SyncResult = { applied: string[]; conflicts: { taskId: string; reason: string }[] };

/** Apply a batch of queued offline updates (FR-4/5, AC-5/6). Stale/illegal ones
 *  are surfaced as conflicts, not applied — the rest go through. */
export async function syncOfflineUpdates(input: unknown): Promise<Result<SyncResult>> {
  return toResult(async () => {
    const data = syncSchema.parse(input);
    const user = await requireUser();
    const applied: string[] = [];
    const conflicts: { taskId: string; reason: string }[] = [];

    for (const u of data.updates) {
      try {
        const task = await loadTask(user, u.taskId);
        authorize(user, "housekeeping:update", task.propertyId);
        await applyStatus(user, task, u.status, u.clientUpdatedAt);
        applied.push(u.taskId);
      } catch (e) {
        const code = e instanceof DomainError ? e.code : "INTERNAL";
        conflicts.push({ taskId: u.taskId, reason: code });
      }
    }
    return { applied, conflicts };
  });
}
