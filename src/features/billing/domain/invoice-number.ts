/**
 * Invoice number formatting — 06 (FR-12/13). Pure formatting only; the ALLOCATION
 * (locking the series, incrementing `nextNumber`) is transactional and lives in
 * the action. Keeping the format here means the shape is unit-testable and every
 * caller (tax invoice + credit note, same series) renders identically.
 *
 *   { prefix: "WMG", financialYear: "2026-27", nextNumber: 42 }
 *     → "WMG/2026-27/00042"
 */
export function formatInvoiceNumber(series: {
  prefix: string;
  financialYear: string;
  nextNumber: number;
}): string {
  return `${series.prefix}/${series.financialYear}/${String(series.nextNumber).padStart(5, "0")}`;
}
