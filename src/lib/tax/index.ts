/**
 * Shared GST tax lib — created for 19-POS (T-4).
 *
 * A pure, dependency-light GST split for on-premise / point-of-consumption
 * supplies, mirroring `business-rules.md` §10–13 and the exact rounding 06 uses
 * in `src/features/billing/domain/gst.ts`.
 *
 * WHY THIS EXISTS SEPARATELY FROM 06:
 *   06 owns the authoritative folio/invoice GST (`features/billing/domain/gst.ts`)
 *   and keeps its own copy. This module is the shared engine POS (and, in a future
 *   refactor, 06) computes bill previews with. They are intentionally kept in
 *   lock-step for now — same formula, same half-up rounding — and a later ADR will
 *   unify them into this single home. Until then, any change here MUST be mirrored
 *   in 06's gst.ts (and vice-versa), or the POS preview and the posted folio line
 *   will diverge.
 *
 * PLACE OF SUPPLY: for on-premise supplies (room, F&B, laundry, POS, …) the place
 * of supply is ALWAYS the property's own state (IGST Act §12(4)), so the split is
 * ALWAYS CGST+SGST regardless of the customer's bill-to state. The IGST branch is
 * retained only for 06's rare genuine off-premise supply; POS never takes it.
 */
import Decimal from "decimal.js";

export type GstBreakup = {
  /** Central GST (paise) — half of the rate for an intra-state supply. */
  cgstPaise: number;
  /** State GST (paise) — the other half. */
  sgstPaise: number;
  /** Integrated GST (paise) — the full rate for a genuine inter-state supply. */
  igstPaise: number;
};

/** On-premise / point-of-consumption supply types — place of supply = property state. */
const ON_PREMISE = new Set([
  "ROOM",
  "FOOD",
  "LAUNDRY",
  "AIRPORT_TRANSFER",
  "TAXI",
  "KITCHEN",
  "EXTRA_BED",
  "POS",
]);

/**
 * Place of supply for a charge (business-rules.md §10 / IGST Act §12). On-premise
 * services resolve to the property's state — a Maharashtra bill-to does NOT make a
 * POS/F&B line inter-state. Only a genuine off-premise supply resolves to bill-to.
 */
export function placeOfSupply(
  chargeType: string,
  propertyState: string,
  billToState?: string | null,
): string {
  if (ON_PREMISE.has(chargeType)) return propertyState;
  return billToState ?? propertyState;
}

/**
 * Place of supply for a POS line — ALWAYS the property's state (FR-4). POS is a
 * point-of-consumption service, so this is not a caller argument.
 */
export function placeOfSupplyForPos(propertyState: string): string {
  return propertyState;
}

/** Round a paise value to the nearest whole paisa, half-up (business-rules.md §8). */
export function roundPaiseHalfUp(value: Decimal | number): number {
  const d = value instanceof Decimal ? value : new Decimal(value);
  return d.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
}

/**
 * Split `taxablePaise` at `rateBps` into CGST/SGST (intra-state) or IGST
 * (inter-state), deciding by place of supply. Intra-state halves are rounded
 * HALF-UP INDEPENDENTLY — their sum may differ from a single rounding by ≤1
 * paisa; that is correct and matches 06 exactly (FR-4, business-rules.md §10).
 */
export function computeLineTax(
  taxablePaise: number,
  rateBps: number,
  propertyState: string,
  placeOfSupplyState: string,
): GstBreakup {
  const total = new Decimal(taxablePaise).times(rateBps).div(10_000);
  if (placeOfSupplyState === propertyState) {
    const half = total.div(2);
    return {
      cgstPaise: roundPaiseHalfUp(half),
      sgstPaise: roundPaiseHalfUp(half),
      igstPaise: 0,
    };
  }
  return { cgstPaise: 0, sgstPaise: 0, igstPaise: roundPaiseHalfUp(total) };
}

/** Convenience: split a POS line — always intra-state (CGST+SGST), never IGST. */
export function splitPosGst(taxablePaise: number, rateBps: number, propertyState: string): GstBreakup {
  return computeLineTax(taxablePaise, rateBps, propertyState, placeOfSupplyForPos(propertyState));
}

export type RoundOff = { roundOffPaise: number; totalPaise: number };

/**
 * Round a grand total to the nearest rupee (100 paise), half-up, returning both
 * the signed round-off adjustment and the rounded total (business-rules.md §8;
 * §12 "total in words" is a whole-rupee figure). A ₹315.47 grand → +53 paise
 * round-off → ₹316 shown; ₹315.20 → −20 paise → ₹315.
 */
export function roundOffToRupee(grandTotalPaise: number): RoundOff {
  const rounded = roundPaiseHalfUp(new Decimal(grandTotalPaise).div(100)) * 100;
  return { roundOffPaise: rounded - grandTotalPaise, totalPaise: rounded };
}
