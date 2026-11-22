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

/** The sequence part of a formatted number ("WASPL :685/ 26-27" → 685), or null. */
export function parseInvoiceSeq(number: string): number | null {
  const m = /:(\d+)\//.exec(number);
  return m ? Number(m[1]) : null;
}

/** An existing invoice row that already carries the number being claimed. */
export type NumberHolder = {
  folioId: string;
  billPart: string | null;
  type: string;
  revision: number;
  /** A tax invoice that is neither superseded nor cancelled by a credit note. */
  live: boolean;
};

export type NumberClaim =
  | { ok: true; revision: number }
  | { ok: false; reason: "taken" | "live" };

/**
 * May this bill (folio + bill part) take a number? (specs/06 FR-RV-3)
 *  - nobody has it → revision 0;
 *  - only this bill's OWN earlier, no-longer-live copies have it (a cancelled or
 *    superseded bill of the same folio, same part — or the old whole-stay bill,
 *    part null) → the next revision: one customer, one bill number;
 *  - another bill has it, or this bill still has a live copy → refused.
 * Credit notes never hold a bill's number, so they are ignored here.
 */
export function decideNumberClaim(holders: NumberHolder[], target: { folioId: string; billPart: string }): NumberClaim {
  const bills = holders.filter((h) => h.type === "TAX_INVOICE");
  if (bills.length === 0) return { ok: true, revision: 0 };
  const own = (h: NumberHolder) => h.folioId === target.folioId && (h.billPart === target.billPart || h.billPart === null);
  if (bills.some((h) => !own(h))) return { ok: false, reason: "taken" };
  if (bills.some((h) => h.live)) return { ok: false, reason: "live" };
  return { ok: true, revision: Math.max(...holders.map((h) => h.revision)) + 1 };
}
