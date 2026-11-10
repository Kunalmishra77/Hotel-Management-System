/**
 * Revenue by booking source, split per line (client, 6 + 10 Nov 2026).
 *
 * WHICH source a folio line belongs to is billing's rule (`lineSource` in
 * 06's bill-parts): a room night → the source that night was sold through (the
 * booking's, or its extension's); anything else on an OTA booking was paid at the
 * hotel → Direct. Reports use the same rule as the separate bills, so the
 * revenue-by-source report and the invoices never disagree. This file only sums.
 */
export type SourcedLine = { source: string; type: string; amountPaise: number | bigint };

/** Adds tax-excluded revenue into `into`, keyed by each line's source. */
export function addRevenueBySource(into: Map<string, number>, lines: readonly SourcedLine[]): void {
  for (const l of lines) {
    if (l.type === "TAX") continue;
    into.set(l.source, (into.get(l.source) ?? 0) + Number(l.amountPaise));
  }
}
