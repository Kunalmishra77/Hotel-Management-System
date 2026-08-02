/**
 * 15 T-4 — toExportRows (FR-5, AC-5/AC-10).
 *
 * The PII gate for exports. Each column is tagged `pii`. A caller WITHOUT
 * `export:pii` gets those columns OMITTED entirely (stronger than masking); a
 * caller WITH it gets the raw value. Non-PII columns always pass through. This
 * is pure so it is exhaustively unit-testable — the permission decision is made
 * by the action and passed in as `canPii`.
 */

export type ExportCell = {
  /** The masked/safe value — what a non-PII export would show if the column weren't PII. */
  value: string | number | null;
  /** The unmasked value, present only when the gather decrypted it for a permitted export. */
  raw?: string | number | null;
  /** PII columns are omitted unless the caller holds export:pii. */
  pii?: boolean;
};

export type ExportRow = {
  entity: string;
  id: string;
  columns: Record<string, ExportCell>;
};

export type FlatRow = Record<string, string | number | null>;

/**
 * Flatten rows to plain records for the file writer, applying the PII gate.
 * The output column set is the union of every non-omitted column across rows so
 * the sheet has stable headers.
 */
export function toExportRows(rows: ExportRow[], canPii: boolean): FlatRow[] {
  return rows.map((row) => {
    const flat: FlatRow = { entity: row.entity, id: row.id };
    for (const [key, cell] of Object.entries(row.columns)) {
      if (cell.pii && !canPii) continue; // omit PII for unauthorized exports (FR-5)
      flat[key] = cell.pii && canPii ? (cell.raw ?? cell.value) : cell.value;
    }
    return flat;
  });
}

/** The header set for a flattened export (union of keys, stable order via first-seen). */
export function exportHeaders(flat: FlatRow[]): string[] {
  const seen: string[] = [];
  for (const row of flat) {
    for (const key of Object.keys(row)) if (!seen.includes(key)) seen.push(key);
  }
  return seen;
}
