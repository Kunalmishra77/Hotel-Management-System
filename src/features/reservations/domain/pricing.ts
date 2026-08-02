/**
 * priceReservation() — 03 T-6 (FR-6, AC-2).
 *
 * The booking bill preview. Everything is integer **paise**; arithmetic goes
 * through Decimal.js per `data-model.md` (never a JS float for money). Inputs are
 * already integer paise, so these adds/multiplies are exact — no rounding is
 * introduced here; the folio (06) owns per-line GST rounding.
 *
 *   total   = rate × nights − discount + extraBed + otherCharges + tax
 *   balance = total − advance
 *
 * AC-2: ₹4,000 × 3 − ₹500 + ₹800 + ₹1,110 = ₹13,410; less ₹5,000 advance = ₹8,410.
 */
import Decimal from "decimal.js";

export type BillInput = {
  ratePaise: number;
  nights: number;
  discountPaise?: number;
  extraBedPaise?: number;
  otherChargesPaise?: number;
  taxPaise?: number;
  advancePaise?: number;
};

export type BillBreakdown = {
  roomPaise: number;
  discountPaise: number;
  extraBedPaise: number;
  otherChargesPaise: number;
  taxPaise: number;
  advancePaise: number;
};

export type BillPreview = {
  totalPaise: number;
  balancePaise: number;
  breakdown: BillBreakdown;
};

export function priceReservation(input: BillInput): BillPreview {
  const discount = input.discountPaise ?? 0;
  const extraBed = input.extraBedPaise ?? 0;
  const other = input.otherChargesPaise ?? 0;
  const tax = input.taxPaise ?? 0;
  const advance = input.advancePaise ?? 0;

  const room = new Decimal(input.ratePaise).times(input.nights);
  const total = room.minus(discount).plus(extraBed).plus(other).plus(tax);
  const balance = total.minus(advance);

  return {
    totalPaise: total.toNumber(),
    balancePaise: balance.toNumber(),
    breakdown: {
      roomPaise: room.toNumber(),
      discountPaise: discount,
      extraBedPaise: extraBed,
      otherChargesPaise: other,
      taxPaise: tax,
      advancePaise: advance,
    },
  };
}
