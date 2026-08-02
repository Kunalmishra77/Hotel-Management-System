/**
 * `dedupPlan` — 26 T-5 (FR-3/6, AC-5/11). Pure domain, no I/O.
 *
 * Decides, per row, whether committing it should CREATE a new record, MERGE into
 * an existing one, or SKIP it as a duplicate — covering BOTH kinds of duplicate:
 *   - within the file  : two rows with the same importKey → first CREATE, rest SKIP.
 *   - against existing : the importKey already matches a live record (looked up
 *                        via 04's dedup by the caller) → SKIP (idempotent re-import).
 *
 * The DB lookup is done by the application layer (it needs 04's `searchGuests`);
 * this function is handed the RESULT as a set, keeping it pure and unit-testable.
 */

export type RowAction = "CREATE" | "MERGE" | "SKIP";

export type PlanRow = {
  rowNum: number;
  /** null ⇒ an ERROR row with no natural key; it is left alone (never CREATE). */
  importKey: string | null;
  /** Row already failed shape validation — excluded from the plan as SKIP-noop. */
  ok: boolean;
};

export type DedupPlanInput = {
  rows: readonly PlanRow[];
  /** importKeys that already exist in the live DB (from 04's dedup lookup). */
  existingKeys: ReadonlySet<string>;
};

/**
 * Returns a map rowNum → action for every OK row that carries an importKey.
 * ERROR rows and keyless rows are omitted (the caller keeps them as ERROR).
 *
 * Determinism: rows are processed in ascending rowNum, so the FIRST occurrence
 * of a within-file duplicate is the CREATE and later ones SKIP — stable across
 * runs (AC-5), which matters because the created targetId is stamped on that row.
 */
export function dedupPlan(input: DedupPlanInput): Map<number, RowAction> {
  const plan = new Map<number, RowAction>();
  const seenInFile = new Set<string>();

  const ordered = [...input.rows].sort((a, b) => a.rowNum - b.rowNum);
  for (const row of ordered) {
    if (!row.ok || !row.importKey) continue;

    if (input.existingKeys.has(row.importKey)) {
      // Matches a record already in the DB → skip (idempotent re-import, AC-11).
      plan.set(row.rowNum, "SKIP");
      continue;
    }
    if (seenInFile.has(row.importKey)) {
      // A later duplicate of a row earlier in THIS file (AC-5).
      plan.set(row.rowNum, "SKIP");
      continue;
    }
    seenInFile.add(row.importKey);
    plan.set(row.rowNum, "CREATE");
  }

  return plan;
}
