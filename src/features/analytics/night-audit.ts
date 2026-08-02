/**
 * Night-audit orchestration — 14 T-6..T-11 (FR-5..10/16, AC-7..12). NOT a
 * "use server" module: run by the pg-boss scheduler (or a permissioned manual
 * trigger) under a system context.
 *
 * Order (design.md § Night audit): claim the run → post room-nights (06) → mark
 * no-shows (03) → build + persist the immutable `DailyStatSnapshot` → roll the
 * business date → mark COMPLETED + emit. The `NightAuditRun` unique
 * `(propertyId, businessDate)` row is the mutex: two concurrent runs, exactly one
 * proceeds (AC-11). A snapshot that already exists → idempotent no-op (AC-8). A
 * failure sets the run FAILED, leaves the date unchanged, and re-runs safely
 * (AC-10) — every downstream call (06/03) is itself idempotent.
 */
import { db } from "@/lib/db";
import { runWithSystemContext } from "@/lib/context";
import { emitEvent } from "@/lib/events";
import { writeAudit } from "@/lib/audit";
import { NotFoundError } from "@/lib/errors";
import { postRoomCharges } from "@/features/billing/night-audit";
import { markNoShows } from "@/features/reservations/jobs";
import { snapshotFrom } from "./domain/metrics";
import { dayBounds } from "./internal";

export type NightAuditResult = { status: "COMPLETED" | "ALREADY_RUN" | "IN_PROGRESS" | "FAILED"; snapshotId?: string };

/** Live inputs for a business date's snapshot (all via this module's reads). */
async function computeInputs(propertyId: string, date: Date) {
  const prisma = db.unscoped();
  const { start, next } = dayBounds(date);

  // Available = active, non-maintenance rooms with no block overlapping the date.
  const [activeRooms, blockedRoomIds, occupied, roomRev, totalRev, expenses] = await Promise.all([
    prisma.room.count({ where: { propertyId, isActive: true, status: { not: "UNDER_MAINTENANCE" } } }),
    prisma.roomBlock.findMany({ where: { propertyId, startDate: { lte: date }, endDate: { gt: date } }, select: { roomId: true } }),
    prisma.roomAllocation.count({ where: { propertyId, startDate: { lte: date }, endDate: { gt: date }, reservation: { status: { in: ["IN_HOUSE", "CHECKED_OUT"] } } } }),
    prisma.folioLine.aggregate({ where: { folio: { propertyId }, businessDate: date, type: "ROOM" }, _sum: { amountPaise: true } }),
    prisma.folioLine.aggregate({ where: { folio: { propertyId }, businessDate: date, type: { notIn: ["TAX"] } }, _sum: { amountPaise: true } }),
    prisma.expense.aggregate({ where: { propertyId, status: "APPROVED", spentOn: { gte: start, lt: next } }, _sum: { amountPaise: true } }),
  ]);
  const blocked = new Set(blockedRoomIds.map((b) => b.roomId)).size;

  return {
    availableRoomNights: Math.max(0, activeRooms - blocked),
    occupiedRoomNights: occupied,
    roomRevenuePaise: BigInt(roomRev._sum.amountPaise ?? 0n),
    totalRevenuePaise: BigInt(totalRev._sum.amountPaise ?? 0n),
    expensePaise: BigInt(expenses._sum.amountPaise ?? 0), // 07-only; 08 adds apportioned staff cost
  };
}

export async function runNightAudit(propertyId: string, businessDate: Date): Promise<NightAuditResult> {
  const prisma = db.unscoped();
  const property = await prisma.property.findUnique({ where: { id: propertyId }, select: { orgId: true } });
  if (!property) throw new NotFoundError("Property not found.");

  // Idempotent: a snapshot already means the day is closed (AC-8).
  const existing = await prisma.dailyStatSnapshot.findUnique({ where: { propertyId_businessDate: { propertyId, businessDate } } });
  if (existing) return { status: "ALREADY_RUN", snapshotId: existing.id };

  // Claim the run — the unique (propertyId, businessDate) row is the mutex (AC-11).
  try {
    await prisma.nightAuditRun.create({ data: { propertyId, businessDate, status: "RUNNING", startedAt: new Date() } });
  } catch {
    const run = await prisma.nightAuditRun.findUnique({ where: { propertyId_businessDate: { propertyId, businessDate } } });
    if (run?.status === "COMPLETED") return { status: "ALREADY_RUN" };
    if (run?.status === "RUNNING") return { status: "IN_PROGRESS" };
    // FAILED → reset to RUNNING atomically; if someone else reset it, stand down.
    const claimed = await prisma.nightAuditRun.updateMany({ where: { propertyId, businessDate, status: "FAILED" }, data: { status: "RUNNING", startedAt: new Date() } });
    if (claimed.count === 0) return { status: "IN_PROGRESS" };
  }

  try {
    // (a) post room-nights, (b) mark no-shows — both idempotent (06/03).
    await postRoomCharges(propertyId, businessDate);
    await markNoShows(propertyId, businessDate);

    const inputs = await computeInputs(propertyId, businessDate);
    const stats = snapshotFrom(inputs);
    const nextDate = new Date(dayBounds(businessDate).next);

    return await runWithSystemContext(property.orgId, () =>
      prisma.$transaction(async (tx) => {
        const snap = await tx.dailyStatSnapshot.create({
          data: {
            propertyId, businessDate,
            availableRoomNights: stats.availableRoomNights,
            occupiedRoomNights: stats.occupiedRoomNights,
            roomRevenuePaise: stats.roomRevenuePaise,
            totalRevenuePaise: stats.totalRevenuePaise,
            expensePaise: stats.expensePaise,
            adrPaise: stats.adrPaise,
            revparPaise: stats.revparPaise,
            occupancyBps: stats.occupancyBps,
          },
          select: { id: true },
        });
        await tx.property.update({ where: { id: propertyId }, data: { currentBusinessDate: nextDate } });
        await tx.nightAuditRun.updateMany({ where: { propertyId, businessDate }, data: { status: "COMPLETED", completedAt: new Date() } });
        await emitEvent(tx, { type: "NightAuditCompleted", aggregateId: propertyId, propertyId, payload: { businessDate: businessDate.toISOString().slice(0, 10), occupancyBps: stats.occupancyBps } });
        await writeAudit(tx, { action: "night-audit:complete", entityType: "DailyStatSnapshot", entityId: snap.id, propertyId, after: { businessDate: businessDate.toISOString().slice(0, 10) } });
        return { status: "COMPLETED" as const, snapshotId: snap.id };
      }),
    );
  } catch (e) {
    // FAILED: date unchanged, no completion event; a re-run resets this same row.
    await prisma.nightAuditRun.updateMany({ where: { propertyId, businessDate }, data: { status: "FAILED" } });
    throw e;
  }
}
