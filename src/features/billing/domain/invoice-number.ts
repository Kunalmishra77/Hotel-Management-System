/**
 * Invoice number formatting — 06 (FR-12/13). Pure formatting only; the ALLOCATION
 * (locking the series, incrementing `nextNumber`) is transactional and lives in
 * the action. Keeping the format here means the shape is unit-testable and every
 * caller (tax invoice + credit note, same series) renders identically.
 *
 * Matches the client's real GST invoice format exactly (sample: "WASPL :730/ 25-26")
 * — prefix, sequence, then the SHORT financial year (last two digits of each year).
 *
 *   { prefix: "WASPL", financialYear: "2025-26", nextNumber: 730 }
 *     → "WASPL :730/ 25-26"
 */
export function formatInvoiceNumber(series: {
  prefix: string;
  financialYear: string;
  nextNumber: number;
}): string {
  // "2025-26" → "25-26" (last two digits of the start year + the 2-digit end year).
  const shortFy = series.financialYear.length >= 4 ? series.financialYear.slice(2) : series.financialYear;
  return `${series.prefix} :${series.nextNumber}/ ${shortFy}`;
}
