/**
 * Money helpers — 06 T-6 (FR-8/12/23, AC-8/9/13). Split validation, the Indian
 * financial-year boundary, and the discount-line builder.
 */
import { computeGst } from "./gst";

/** A split payment's parts must sum EXACTLY to the total (FR-23, AC-9). */
export function splitSumsTo(parts: Array<bigint | number>, totalPaise: bigint | number): boolean {
  const sum = parts.reduce<bigint>((acc, p) => acc + BigInt(p), 0n);
  return sum === BigInt(totalPaise);
}

/**
 * Indian financial year for a date, in property-local time (FR-12, AC-13).
 * The year runs 1 April → 31 March: Jan–Mar of year N belong to FY `(N-1)-(N)`.
 * Returns "YYYY-YY" (e.g. `2026-27`).
 */
export function financialYearOf(date: Date, timezone = "Asia/Kolkata"): string {
  const [y, m] = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
  })
    .format(date)
    .split("-")
    .map(Number);
  const startYear = m! >= 4 ? y! : y! - 1;
  const endYear = startYear + 1;
  return `${startYear}-${String(endYear).slice(-2)}`;
}

export type DiscountLineDraft = {
  amountPaise: number;
  taxRateBps: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
};

/**
 * Build a negative DISCOUNT line (FR-6, AC-6).
 *  - PRE_TAX: reduces the taxable value and carries negated proportional GST, so
 *    the tax the guest pays drops with the discount.
 *  - FINANCIAL: a flat reduction with zero tax (a goodwill / rounding credit).
 */
export function discountLine(
  baseTaxablePaise: number,
  rateBps: number,
  propertyState: string,
  placeOfSupplyState: string,
  mode: "PRE_TAX" | "FINANCIAL",
): DiscountLineDraft {
  const amountPaise = -Math.abs(baseTaxablePaise);
  if (mode === "FINANCIAL") {
    return { amountPaise, taxRateBps: 0, cgstPaise: 0, sgstPaise: 0, igstPaise: 0 };
  }
  const gst = computeGst(Math.abs(baseTaxablePaise), rateBps, propertyState, placeOfSupplyState);
  return {
    amountPaise,
    taxRateBps: rateBps,
    cgstPaise: -gst.cgstPaise,
    sgstPaise: -gst.sgstPaise,
    igstPaise: -gst.igstPaise,
  };
}
