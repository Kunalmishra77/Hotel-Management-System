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
import { ROOM_TARIFF_BANDS, roomGstBps } from "@/lib/constants/gst";

/**
 * The PRE-TAX nightly rate from the figure an operator typed — 03 (glossary: a
 * booking's stored `ratePaise` is always pre-tax).
 *
 * Reception quotes a room both ways ("₹2,500 plus tax" / "₹2,625 all-in"), so
 * every rate entry point resolves the same two cases. Defined once here because
 * it was being re-derived inline at each one, and a wrong answer silently
 * mis-prices every night of the stay.
 *
 * Backing GST out is not a single division, because the room GST rate depends on
 * the TARIFF — which is the very number being solved for. Dividing by the band of
 * the all-in figure is self-inconsistent near the ₹7,500 threshold: ₹7,875 all-in
 * divided at 18% gives ₹6,673, a tariff whose own band is 5%, so the stay bills
 * ₹7,007 and the guest is under-charged. So each band is tried and the one whose
 * result agrees with its own band is the answer (₹7,875 → ₹7,500 + ₹375 ✔).
 * Bands are tried low-rate first, keeping an ambiguous figure at the lower,
 * no-ITC rate.
 */
export function preTaxRatePaise(enteredPaise: number, gstMode: "inclusive" | "exclusive"): number {
  if (gstMode !== "inclusive") return enteredPaise;
  for (const band of ROOM_TARIFF_BANDS) {
    const candidate = Math.round((enteredPaise * 10_000) / (10_000 + band.bps));
    if (roomGstBps(candidate) === band.bps) return candidate;
  }
  // Unreachable with the shipped bands (the top band is unbounded); the lowest
  // band is the safe fallback if a future config leaves a gap.
  return Math.round((enteredPaise * 10_000) / (10_000 + roomGstBps(enteredPaise)));
}

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
