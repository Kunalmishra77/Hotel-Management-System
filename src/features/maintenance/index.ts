/**
 * Maintenance — public surface (minimal, pre-11).
 *
 * 11-maintenance (next module) owns maintenance jobs + preventive schedules. It
 * isn't built yet, but 10-housekeeping must raise a job when a cleaner reports a
 * complaint (FR-6). Rather than have 10 write `MaintenanceJob` directly (a
 * boundary breach), this surface exposes `raiseMaintenanceJob`; 11 expands it.
 * Same pattern + rationale as ADR 0006 (billing before 06).
 */
import type { Prisma } from "@prisma/client";
import { emitEvent, type EventCapableTx } from "@/lib/events";

export type MaintenanceCapableTx = EventCapableTx & {
  maintenanceJob: {
    create(args: { data: Prisma.MaintenanceJobUncheckedCreateInput; select: { id: true } }): Promise<{ id: string }>;
  };
};

export type RaiseJobInput = {
  propertyId: string;
  roomId?: string | null;
  category: "AC" | "ELECTRICAL" | "PLUMBING" | "FURNITURE" | "PAINTING" | "PEST_CONTROL" | "OTHER";
  description: string;
  reportedById?: string | null;
};

/** Create an OPEN maintenance job inside the caller's transaction (FR-6). */
export async function raiseMaintenanceJob(
  tx: MaintenanceCapableTx,
  input: RaiseJobInput,
): Promise<{ jobId: string }> {
  const job = await tx.maintenanceJob.create({
    data: {
      propertyId: input.propertyId,
      roomId: input.roomId ?? null,
      category: input.category,
      description: input.description,
      status: "OPEN",
      priority: "NORMAL",
      reportedById: input.reportedById ?? null,
    },
    select: { id: true },
  });
  await emitEvent(tx, { type: "MaintenanceJobCreated", aggregateId: job.id, propertyId: input.propertyId, payload: { roomId: input.roomId ?? null, category: input.category, source: "complaint" } });
  return { jobId: job.id };
}
