/**
 * Rollback core — 26 T-15 (FR-8, AC-12). An UNCOMMITTED batch is simply
 * discarded (rows + stored file removed). A COMMITTED batch is reversed by
 * soft-voiding ONLY the records it created — found via `ImportRow.targetId` —
 * through each owning module's authorized action, never touching a record it did
 * not create. Emits `ImportRolledBack` + audit.
 */
import type { ImportBatch } from "@prisma/client";
import { writeAudit } from "@/lib/audit";
import { resolveStorageAdapter } from "@/lib/storage";
import { eraseGuest } from "@/features/guests/erase-actions";
import { reverseFolioLine } from "@/features/billing/charge-actions";
import { cancelReservation } from "@/features/reservations/lifecycle-actions";
import { db } from "@/lib/db";
import { importDb, withImportContext } from "./internal";
import { emitImportRolledBack } from "./events";
import type { SessionClaims } from "@/lib/auth/claims";

export type RollbackSummary = { discarded: boolean; voided: number; skipped: number };

export async function runRollback(
  user: SessionClaims,
  batch: ImportBatch,
  reason: string | null,
): Promise<RollbackSummary> {
  const prisma = importDb();

  // --- Uncommitted → discard entirely -----------------------------------
  if (batch.status !== "COMMITTED") {
    await withImportContext(user, () =>
      prisma.$transaction(async (tx) => {
        await emitImportRolledBack(tx, { batchId: batch.id, kind: batch.kind, voided: 0, propertyId: batch.propertyId });
        await writeAudit(tx, {
          action: "data:import-discard", entityType: "ImportBatch", entityId: batch.id,
          propertyId: batch.propertyId, reason, after: { discarded: true },
        });
        await tx.importRow.deleteMany({ where: { batchId: batch.id } });
        await tx.importBatch.delete({ where: { id: batch.id } });
      }),
    );
    // Remove the stored source last — a missing object is fine, the goal is it's gone.
    await resolveStorageAdapter().delete(batch.fileObjectKey).catch(() => {});
    return { discarded: true, voided: 0, skipped: 0 };
  }

  // --- Committed → soft-void what we created ----------------------------
  const rows = await prisma.importRow.findMany({
    where: { batchId: batch.id, targetId: { not: null } },
    select: { rowNum: true, targetType: true, targetId: true },
    orderBy: { rowNum: "asc" },
  });

  let voided = 0;
  let skipped = 0;
  for (const row of rows) {
    const ok = await voidTarget(user, batch, row.targetType, row.targetId!, reason);
    if (ok) voided++;
    else skipped++;
  }

  await withImportContext(user, () =>
    prisma.$transaction(async (tx) => {
      await emitImportRolledBack(tx, { batchId: batch.id, kind: batch.kind, voided, propertyId: batch.propertyId });
      await writeAudit(tx, {
        action: "data:import-rollback", entityType: "ImportBatch", entityId: batch.id,
        propertyId: batch.propertyId, reason, after: { voided, skipped },
      });
      await tx.importBatch.update({ where: { id: batch.id }, data: { status: "ROLLED_BACK" } });
    }),
  );

  return { discarded: false, voided, skipped };
}

/** Void a single created target through its owning module. Returns false if not voidable. */
async function voidTarget(
  user: SessionClaims,
  batch: ImportBatch,
  targetType: string | null,
  targetId: string,
  reason: string | null,
): Promise<boolean> {
  const why = reason ?? `Rolled back import batch ${batch.id}`;
  try {
    if (targetType === "Guest") {
      const res = await eraseGuest({ guestId: targetId, reason: why });
      return res.ok;
    }
    if (targetType === "FolioLine") {
      const res = await reverseFolioLine({ lineId: targetId, reason: why });
      return res.ok;
    }
    if (targetType === "Reservation") {
      // Only a non-terminal reservation is cancellable; a CHECKED_OUT historical
      // stay is terminal by the 03 state machine and is left in place (documented).
      const status = await db.scoped(user).reservation.findFirst({
        where: { id: targetId }, select: { status: true },
      });
      if (status && (status.status === "CONFIRMED" || status.status === "ENQUIRY")) {
        const res = await cancelReservation({ reservationId: targetId, reason: why });
        return res.ok;
      }
      return false;
    }
  } catch {
    return false;
  }
  return false;
}
