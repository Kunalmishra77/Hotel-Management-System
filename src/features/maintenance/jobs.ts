/**
 * Preventive-maintenance reminders — 11 T-8 (FR-4, AC-6). NOT a "use server"
 * module: run by the pg-boss worker on a tick, under a system context.
 *
 * For each preventive job due within `MAINTENANCE_PREVENTIVE_REMINDER_LEAD_DAYS`,
 * emit `MaintenanceScheduled` (12 turns it into a reminder) and advance
 * `scheduledFor` to the next occurrence — so the reminder fires once per due date
 * and the schedule recurs.
 */
import { db } from "@/lib/db";
import { runWithSystemContext } from "@/lib/context";
import { emitEvent } from "@/lib/events";
import { writeAudit } from "@/lib/audit";
import { MAINTENANCE_PREVENTIVE_REMINDER_LEAD_DAYS } from "@/lib/constants/maintenance";
import { nextPreventiveDate } from "./domain/lifecycle";

export async function runPreventiveReminders(now: Date = new Date()): Promise<{ reminded: number }> {
  const prisma = db.unscoped();
  const windowEnd = new Date(now.getTime() + MAINTENANCE_PREVENTIVE_REMINDER_LEAD_DAYS * 86_400_000);

  const due = await prisma.maintenanceJob.findMany({
    where: { isPreventive: true, status: { not: "CLOSED" }, scheduledFor: { gte: now, lte: windowEnd } },
    select: { id: true, propertyId: true, scheduledFor: true, recurrence: true },
  });

  let reminded = 0;
  for (const job of due) {
    if (!job.scheduledFor) continue;
    const prop = await prisma.property.findUnique({ where: { id: job.propertyId }, select: { orgId: true } });
    if (!prop) continue;
    const next = job.recurrence ? nextPreventiveDate(job.scheduledFor, job.recurrence) : null;
    await runWithSystemContext(prop.orgId, () =>
      prisma.$transaction(async (tx) => {
        await emitEvent(tx, { type: "MaintenanceScheduled", aggregateId: job.id, propertyId: job.propertyId, payload: { dueOn: job.scheduledFor!.toISOString().slice(0, 10) } });
        await tx.maintenanceJob.updateMany({ where: { id: job.id }, data: { scheduledFor: next } });
        await writeAudit(tx, { action: "maintenance:preventive-reminder", entityType: "MaintenanceJob", entityId: job.id, propertyId: job.propertyId, after: { nextDueOn: next?.toISOString().slice(0, 10) ?? null } });
      }),
    );
    reminded += 1;
  }
  return { reminded };
}
