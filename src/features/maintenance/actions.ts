"use server";

/**
 * Maintenance job actions — 11 T-5/T-6/T-7 (FR-1/2/3/5/6, AC-1/3/4/5/7/8).
 * `maintenance:manage`. A room block for a job is the INVERSE of no-overbooking:
 * `blockRoomForJob` refuses to block a room that has a confirmed/in-house
 * reservation overlapping the range (`ROOM_HAS_RESERVATION`) — the guest is
 * reallocated (03) first, so a block never coexists with a live reservation.
 */
import { requireUser } from "@/lib/auth";
import { authorize } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import { emitEvent } from "@/lib/events";
import { DomainError, ErrorCode, NotFoundError } from "@/lib/errors";
import { toResult, type Result } from "@/lib/result";
import { blockRoom, unblockRoom } from "@/features/rooms/block-actions";
import { canTransition, type JobStatus } from "./domain/lifecycle";
import { maintenanceDb, withMaintenanceContext } from "./internal";
import { createJobSchema, startJobSchema, closeJobSchema, blockRoomForJobSchema } from "./schema";

export type JobResult = { jobId: string; status?: string };

/** Create a maintenance job (FR-1/2, AC-1). Manual entry or a 10 complaint. */
export async function createJob(input: unknown): Promise<Result<JobResult>> {
  return toResult(async () => {
    const data = createJobSchema.parse(input);
    const user = await requireUser();
    authorize(user, "maintenance:manage", data.propertyId);

    return withMaintenanceContext(user, () =>
      maintenanceDb(user).$transaction(async (tx) => {
        const job = await tx.maintenanceJob.create({
          data: {
            propertyId: data.propertyId,
            roomId: data.roomId ?? null,
            category: data.category,
            description: data.description,
            priority: data.priority,
            status: "OPEN",
            isPreventive: data.isPreventive,
            scheduledFor: data.scheduledFor ?? null,
            recurrence: data.recurrence ?? null,
            reportedById: user.userId,
          },
          select: { id: true },
        });
        await emitEvent(tx, { type: "MaintenanceJobCreated", aggregateId: job.id, propertyId: data.propertyId, payload: { category: data.category, roomId: data.roomId ?? null, priority: data.priority } });
        await writeAudit(tx, { action: "maintenance:create", entityType: "MaintenanceJob", entityId: job.id, propertyId: data.propertyId, after: { category: data.category, priority: data.priority } });
        return { jobId: job.id, status: "OPEN" };
      }),
    );
  });
}

type LoadedJob = { id: string; propertyId: string; roomId: string | null; status: string; roomBlockId: string | null };

async function loadJob(user: Awaited<ReturnType<typeof requireUser>>, jobId: string): Promise<LoadedJob> {
  const job = await maintenanceDb(user).maintenanceJob.findFirst({
    where: { id: jobId },
    select: { id: true, propertyId: true, roomId: true, status: true, roomBlockId: true },
  });
  if (!job) throw new NotFoundError("Maintenance job not found.");
  return job;
}

/** Start a job: OPEN→IN_PROGRESS (FR-6). */
export async function startJob(input: unknown): Promise<Result<JobResult>> {
  return toResult(async () => {
    const { jobId } = startJobSchema.parse(input);
    const user = await requireUser();
    const job = await loadJob(user, jobId);
    authorize(user, "maintenance:manage", job.propertyId);
    if (!canTransition(job.status as JobStatus, "IN_PROGRESS")) throw new DomainError(ErrorCode.ILLEGAL_TRANSITION);

    return withMaintenanceContext(user, () =>
      maintenanceDb(user).$transaction(async (tx) => {
        await tx.maintenanceJob.updateMany({ where: { id: jobId }, data: { status: "IN_PROGRESS" } });
        await writeAudit(tx, { action: "maintenance:start", entityType: "MaintenanceJob", entityId: jobId, propertyId: job.propertyId, before: { status: job.status }, after: { status: "IN_PROGRESS" } });
        return { jobId, status: "IN_PROGRESS" };
      }),
    );
  });
}

/** Close a job with an optional cost; unblocks the room if it was blocked (FR-5, AC-4/5). */
export async function closeJob(input: unknown): Promise<Result<JobResult>> {
  return toResult(async () => {
    const { jobId, costPaise } = closeJobSchema.parse(input);
    const user = await requireUser();
    const job = await loadJob(user, jobId);
    authorize(user, "maintenance:manage", job.propertyId);
    if (!canTransition(job.status as JobStatus, "CLOSED")) throw new DomainError(ErrorCode.ILLEGAL_TRANSITION); // AC-5

    // Unblock the room (02) BEFORE the close commits — the block outliving a
    // closed job would strand the room out of availability.
    if (job.roomBlockId) {
      const unblocked = await unblockRoom({ blockId: job.roomBlockId });
      if (!unblocked.ok) throw new DomainError(unblocked.error.code as ErrorCode, unblocked.error.message);
    }

    return withMaintenanceContext(user, () =>
      maintenanceDb(user).$transaction(async (tx) => {
        await tx.maintenanceJob.updateMany({ where: { id: jobId }, data: { status: "CLOSED", closedAt: new Date(), costPaise: costPaise ?? null, roomBlockId: null } });
        await emitEvent(tx, { type: "MaintenanceJobClosed", aggregateId: jobId, propertyId: job.propertyId, payload: { costPaise: costPaise ?? null } });
        await writeAudit(tx, { action: "maintenance:close", entityType: "MaintenanceJob", entityId: jobId, propertyId: job.propertyId, before: { status: job.status }, after: { status: "CLOSED", costPaise: costPaise ?? null } });
        return { jobId, status: "CLOSED" };
      }),
    );
  });
}

/** Block a room for a job (FR-3, AC-3/8). Refuses if a live reservation overlaps. */
export async function blockRoomForJob(input: unknown): Promise<Result<{ roomBlockId: string }>> {
  return toResult(async () => {
    const data = blockRoomForJobSchema.parse(input);
    const user = await requireUser();
    const job = await loadJob(user, data.jobId);
    authorize(user, "maintenance:manage", job.propertyId);
    if (!job.roomId) throw new DomainError(ErrorCode.VALIDATION_FAILED, "This job is not tied to a room.");

    // A block must NEVER coexist with a confirmed/in-house reservation on the same
    // room-nights (inverse of no-overbooking). `force` never bypasses a real
    // overlap — it is only meaningful once the guest has been reallocated (03).
    const conflict = await maintenanceDb(user).roomAllocation.findFirst({
      where: {
        roomId: job.roomId,
        startDate: { lt: data.endDate },
        endDate: { gt: data.startDate },
        reservation: { status: { in: ["CONFIRMED", "IN_HOUSE"] } },
      },
      select: { id: true },
    });
    if (conflict) throw new DomainError(ErrorCode.ROOM_HAS_RESERVATION);

    const blocked = await blockRoom({ roomId: job.roomId, startDate: data.startDate, endDate: data.endDate, reason: "Maintenance", maintenanceJobId: data.jobId });
    if (!blocked.ok) throw new DomainError(blocked.error.code as ErrorCode, blocked.error.message);

    return withMaintenanceContext(user, () =>
      maintenanceDb(user).$transaction(async (tx) => {
        await tx.maintenanceJob.updateMany({ where: { id: data.jobId }, data: { roomBlockId: blocked.data.id } });
        await writeAudit(tx, { action: "maintenance:block-room", entityType: "MaintenanceJob", entityId: data.jobId, propertyId: job.propertyId, after: { roomBlockId: blocked.data.id, roomId: job.roomId } });
        return { roomBlockId: blocked.data.id };
      }),
    );
  });
}
