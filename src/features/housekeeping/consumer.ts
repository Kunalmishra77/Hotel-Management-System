/**
 * Housekeeping event consumer — 10 (FR-2, AC-1/6). Reacts to room status changes:
 *  - a room entering HOUSEKEEPING (e.g. after checkout) → create a PENDING
 *    cleaning task (idempotent: one open task per room);
 *  - any OTHER status change for a room with an open task → advance the task's
 *    `serverStatusChangedAt`, so a later offline "clean" is detected STALE
 *    (AC-6 — a re-occupied room can't be cleaned by an out-of-date write).
 */
import { db } from "@/lib/db";
import { runWithSystemContext } from "@/lib/context";
import { writeAudit } from "@/lib/audit";
import { registerConsumer, type EventConsumer, type EventEnvelope } from "@/lib/events/dispatch";

async function handle(envelope: EventEnvelope): Promise<void> {
  const payload = (envelope.payload ?? {}) as { to?: string };
  const roomId = envelope.aggregateId; // RoomStatusChanged is keyed by roomId
  const prisma = db.unscoped();

  const open = await prisma.housekeepingTask.findFirst({
    where: { roomId, status: { in: ["PENDING", "IN_PROGRESS"] } },
    select: { id: true },
  });

  if (payload.to === "HOUSEKEEPING") {
    if (open) return; // already have an open task — idempotent
    await runWithSystemContext(envelope.orgId, () =>
      prisma.$transaction(async (tx) => {
        const task = await tx.housekeepingTask.create({
          data: { propertyId: envelope.propertyId ?? "", roomId, type: "CLEANING", status: "PENDING", serverStatusChangedAt: envelope.occurredAt },
          select: { id: true },
        });
        await writeAudit(tx, { action: "housekeeping:task-created", entityType: "HousekeepingTask", entityId: task.id, propertyId: envelope.propertyId, after: { roomId } });
      }),
    );
    return;
  }

  // A different status change (e.g. re-occupation) advances the conflict clock.
  if (open) {
    await prisma.housekeepingTask.updateMany({ where: { id: open.id }, data: { serverStatusChangedAt: envelope.occurredAt } });
  }
}

export const housekeepingConsumer: EventConsumer = {
  name: "housekeeping",
  types: ["RoomStatusChanged"],
  handle,
};

let registered = false;
export function registerHousekeepingConsumer(): void {
  if (registered) return;
  registerConsumer(housekeepingConsumer);
  registered = true;
}
