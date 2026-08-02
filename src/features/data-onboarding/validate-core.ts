/**
 * Dry-run validation core — 26 T-8 (FR-3, AC-4/5/13). Classifies every row and
 * persists per-row status/action + batch counts, then sets the batch VALIDATED.
 *
 * CONTRACT: this writes NOTHING to any target module — no Guest, Reservation or
 * FolioLine is created here (asserted by the integration test). It only reads
 * (04 identity lookup, master-data existence) and updates ImportRow/ImportBatch.
 */
import type { ImportBatch, ImportRow } from "@prisma/client";
import { ErrorCode, messageForCode } from "@/lib/errors";
import { validateRow, type ImportKindName, type NormalizedRow } from "./domain/validate";
import { importKeyFor } from "./domain/import-key";
import { dedupPlan, type PlanRow, type RowAction } from "./domain/dedup-plan";
import { importDb } from "./internal";
import { loadMasterData, lookupGuestsByMobile, type MasterData } from "./lookups";
import type { SessionClaims } from "@/lib/auth/claims";

export type Classified = {
  rowNum: number;
  status: "OK" | "ERROR" | "SKIPPED_DUPLICATE";
  action: RowAction;
  importKey: string | null;
  error: string | null;
};

export type ValidateProgress = (done: number, total: number) => Promise<void> | void;

export async function classifyBatch(
  user: SessionClaims,
  batch: ImportBatch,
  rows: ImportRow[],
): Promise<Classified[]> {
  const kind = batch.kind as ImportKindName;

  // Shape validation first — pure, per row.
  const shaped = rows.map((row) => {
    const res = validateRow((row.raw ?? {}) as Record<string, string>, kind);
    return { row, ...res, importKey: importKeyFor(kind, res.normalized) };
  });

  // Cross-record checks that need the DB (reads only).
  const mobiles = shaped.map((r) => r.normalized.mobile).filter((m): m is string => !!m);
  const guestByMobile = await lookupGuestsByMobile(user.orgId, mobiles);
  const master =
    batch.propertyId && (kind === "RESERVATIONS" || kind === "ROOMS")
      ? await loadMasterData(user, batch.propertyId)
      : null;

  const classified: Classified[] = shaped.map(({ row, errors, normalized, importKey }) => {
    const allErrors = [...errors];
    applyCrossChecks(kind, normalized, guestByMobile, master, allErrors);
    return {
      rowNum: row.rowNum,
      status: allErrors.length > 0 ? "ERROR" : "OK",
      action: "CREATE" as RowAction,
      importKey,
      error: allErrors.length > 0 ? allErrors.join(" ") : null,
    };
  });

  // Dedup: within-file + against existing guests (existing-record dedup applies
  // to GUESTS — the CRM identity; other kinds rely on the owning module's own
  // idempotency at commit, e.g. 03's channelRef).
  const existingKeys = new Set<string>();
  if (kind === "GUESTS") {
    for (const c of classified) {
      if (c.status !== "ERROR" && c.importKey) {
        const mobile = c.importKey.split(":")[1];
        if (mobile && guestByMobile.has(mobile)) existingKeys.add(c.importKey);
      }
    }
  }
  const planRows: PlanRow[] = classified.map((c) => ({
    rowNum: c.rowNum,
    importKey: c.importKey,
    ok: c.status !== "ERROR",
  }));
  const plan = dedupPlan({ rows: planRows, existingKeys });

  for (const c of classified) {
    if (c.status === "ERROR") continue;
    const action = plan.get(c.rowNum);
    if (action === "SKIP") { c.status = "SKIPPED_DUPLICATE"; c.action = "SKIP"; }
    else c.action = action ?? "CREATE";
  }

  return classified;
}

function applyCrossChecks(
  kind: ImportKindName,
  n: NormalizedRow,
  guestByMobile: Map<string, string>,
  master: MasterData | null,
  errors: string[],
): void {
  if (errors.length > 0) return; // don't pile guard errors onto a malformed row

  if (kind === "RESERVATIONS" || kind === "BALANCES") {
    if (n.mobile && !guestByMobile.has(n.mobile)) {
      errors.push(messageForCode(ErrorCode.GUEST_UNMATCHED));
    }
  }
  if (kind === "RESERVATIONS" && master) {
    if (n.roomNo && !master.roomsByNumber.has(n.roomNo.toLowerCase())) {
      errors.push(`Unknown room "${n.roomNo}" — import master data first.`);
    } else if (!n.roomNo && n.categoryName && !master.categoriesByName.has(n.categoryName.toLowerCase())) {
      errors.push(`Unknown room category "${n.categoryName}" — import master data first.`);
    }
  }
  if (kind === "ROOMS" && master && n.categoryName && !master.categoriesByName.has(n.categoryName.toLowerCase())) {
    errors.push(`Unknown room category "${n.categoryName}" — import master data first.`);
  }
}

/** Persist classifications + batch counts, then set the batch VALIDATED. No target writes. */
export async function persistValidation(
  batch: ImportBatch,
  classified: Classified[],
  progress?: ValidateProgress,
): Promise<{ okCount: number; errorCount: number; duplicateCount: number }> {
  const db = importDb();
  let okCount = 0, errorCount = 0, duplicateCount = 0;
  let done = 0;

  for (const c of classified) {
    if (c.status === "OK") okCount++;
    else if (c.status === "ERROR") errorCount++;
    else duplicateCount++;

    await db.importRow.updateMany({
      where: { batchId: batch.id, rowNum: c.rowNum },
      data: { status: c.status, action: c.action, importKey: c.importKey, error: c.error },
    });
    done++;
    if (progress && done % 200 === 0) await progress(done, classified.length);
  }

  await db.importBatch.update({
    where: { id: batch.id },
    data: { status: "VALIDATED", okCount, errorCount, duplicateCount },
  });
  if (progress) await progress(classified.length, classified.length);
  return { okCount, errorCount, duplicateCount };
}

/** Full dry-run: classify + persist. Used inline and by the pg-boss job. */
export async function runValidation(
  user: SessionClaims,
  batch: ImportBatch,
  progress?: ValidateProgress,
): Promise<{ okCount: number; errorCount: number; duplicateCount: number }> {
  const rows = await importDb().importRow.findMany({
    where: { batchId: batch.id },
    orderBy: { rowNum: "asc" },
  });
  const classified = await classifyBatch(user, batch, rows);
  return persistValidation(batch, classified, progress);
}
