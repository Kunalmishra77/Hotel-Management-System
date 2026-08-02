/**
 * Commit core — 26 T-10/T-11/T-14 (FR-4/5/6). Guard → per-row create via the
 * owning modules (04/03/06) in batched, resumable steps → stamp targetId → emit
 * `ImportCommitted` + audit. Idempotent: rows already stamped are skipped, and
 * each owning action's own dedup makes a re-run a no-op (AC-11).
 */
import type { ImportBatch } from "@prisma/client";
import { writeAudit } from "@/lib/audit";
import { DomainError, ErrorCode } from "@/lib/errors";
import { validateRow, type ImportKindName } from "./domain/validate";
import { importKeyFor } from "./domain/import-key";
import { chunk, COMMIT_CHUNK_SIZE, importDb, withImportContext } from "./internal";
import { loadMasterData, lookupGuestsByMobile } from "./lookups";
import { emitImportCommitted } from "./events";
import {
  commitBalanceRow,
  commitGuestRow,
  commitReservationRow,
  type CommitOutcome,
} from "./committers";
import type { SessionClaims } from "@/lib/auth/claims";

export type CommitProgress = (done: number, total: number) => Promise<void> | void;
export type CommitSummary = { created: number; skipped: number; errored: number };

/** Refuse a commit that isn't a clean VALIDATED batch (FR-4, AC-8). */
export function assertCommittable(batch: ImportBatch): void {
  if (batch.status !== "VALIDATED" && batch.status !== "COMMITTING") {
    throw new DomainError(ErrorCode.CONFLICT, "Batch not validated", {
      publicMessage: "Validate this batch before committing.",
      details: { code: "COMMIT_NOT_ALLOWED", status: batch.status },
    });
  }
  if (batch.errorCount > 0) {
    throw new DomainError(ErrorCode.CONFLICT, "Batch has unresolved errors", {
      publicMessage: `Fix or remove the ${batch.errorCount} error row(s) and re-validate before committing.`,
      details: { code: "COMMIT_NOT_ALLOWED", errorCount: batch.errorCount },
    });
  }
}

export async function runCommit(
  user: SessionClaims,
  batch: ImportBatch,
  progress?: CommitProgress,
): Promise<CommitSummary> {
  assertCommittable(batch);
  const kind = batch.kind as ImportKindName;
  const db = importDb();

  await db.importBatch.update({ where: { id: batch.id }, data: { status: "COMMITTING" } });

  // Only OK rows marked CREATE and not yet committed — this is what makes a
  // resumed/re-run commit idempotent at the batch level.
  const rows = await db.importRow.findMany({
    where: { batchId: batch.id, status: "OK", action: "CREATE", targetId: null },
    orderBy: { rowNum: "asc" },
  });

  // Cross-record context for reservations/balances (guest identity + master data).
  const decoded = rows.map((row) => {
    const n = validateRow((row.raw ?? {}) as Record<string, string>, kind).normalized;
    return { row, n, importKey: importKeyFor(kind, n) };
  });
  const mobiles = decoded.map((d) => d.n.mobile).filter((m): m is string => !!m);
  const guestByMobile =
    kind === "RESERVATIONS" || kind === "BALANCES"
      ? await lookupGuestsByMobile(user.orgId, mobiles)
      : new Map<string, string>();
  const master =
    kind === "RESERVATIONS" && batch.propertyId
      ? await loadMasterData(user, batch.propertyId)
      : null;

  const summary: CommitSummary = { created: 0, skipped: 0, errored: 0 };
  let done = 0;

  for (const group of chunk(decoded, COMMIT_CHUNK_SIZE)) {
    for (const { row, n, importKey } of group) {
      const outcome = await commitRow(user, batch, kind, n, importKey, guestByMobile, master);

      await db.importRow.updateMany({
        where: { batchId: batch.id, rowNum: row.rowNum },
        data: {
          status: outcome.status,
          targetType: outcome.targetType ?? null,
          targetId: outcome.targetId ?? null,
          error: outcome.error ?? null,
        },
      });
      if (outcome.status === "OK") summary.created++;
      else if (outcome.status === "SKIPPED_DUPLICATE") summary.skipped++;
      else summary.errored++;
      done++;
    }
    await db.importBatch.update({ where: { id: batch.id }, data: { okCount: summary.created } });
    if (progress) await progress(done, decoded.length);
  }

  // Finalize: event + audit + status, in one small transaction (with context so
  // the event/audit carry the actor).
  await withImportContext(user, () =>
    db.$transaction(async (tx) => {
      await emitImportCommitted(tx, {
        batchId: batch.id,
        kind,
        okCount: summary.created,
        propertyId: batch.propertyId,
      });
      await writeAudit(tx, {
        action: "data:import-commit",
        entityType: "ImportBatch",
        entityId: batch.id,
        propertyId: batch.propertyId,
        after: { kind, ...summary },
      });
      await tx.importBatch.update({
        where: { id: batch.id },
        data: { status: "COMMITTED", committedAt: new Date(), okCount: summary.created },
      });
    }),
  );

  return summary;
}

async function commitRow(
  user: SessionClaims,
  batch: ImportBatch,
  kind: ImportKindName,
  n: ReturnType<typeof validateRow>["normalized"],
  importKey: string | null,
  guestByMobile: Map<string, string>,
  master: Awaited<ReturnType<typeof loadMasterData>> | null,
): Promise<CommitOutcome> {
  if (kind === "GUESTS") return commitGuestRow(n);

  if (!batch.propertyId) return { status: "ERROR", error: "Batch has no property for this kind." };
  const guestId = n.mobile ? guestByMobile.get(n.mobile) : undefined;
  if (!guestId) return { status: "ERROR", error: "No matching guest for this row." };

  if (kind === "RESERVATIONS") {
    if (!importKey || !master) return { status: "ERROR", error: "Missing booking key or master data." };
    return commitReservationRow(user, batch.propertyId, importKey, n, guestId, master);
  }
  if (kind === "BALANCES") return commitBalanceRow(batch.propertyId, n, guestId);

  return { status: "ERROR", error: `Commit is not enabled for kind ${kind}.` };
}
