/**
 * GST computation — 06 T-4 (FR-4/19, AC-3/4/4b/5, business-rules.md §10).
 *
 * The place of supply — NOT the guest's bill-to state — decides intra vs inter.
 * `placeOfSupply()` resolves it (property state for on-premise supplies); then:
 *   place == property state  → CGST + SGST (each half of the rate, rounded
 *                              HALF-UP INDEPENDENTLY — their sum may differ from
 *                              a single rounding by ≤1 paisa; that is correct).
 *   place != property state  → IGST (the full rate).
 */
import Decimal from "decimal.js";

/** On-premise / point-of-consumption supplies: place of supply = property state. */
const ON_PREMISE = new Set([
  "ROOM", "FOOD", "LAUNDRY", "AIRPORT_TRANSFER", "TAXI", "KITCHEN", "EXTRA_BED", "POS",
]);

/**
 * Place of supply for a charge (business-rules.md §10 / IGST Act §12). On-premise
 * services are always the property's state — a Maharashtra bill-to does NOT make
 * a room/laundry charge inter-state (AC-4). Only a genuine off-premise supply
 * (e.g. goods dispatched out of state) resolves to the bill-to state (AC-4b).
 */
export function placeOfSupply(
  chargeType: string,
  propertyState: string,
  billToState?: string | null,
): string {
  if (ON_PREMISE.has(chargeType)) return propertyState;
  return billToState ?? propertyState;
}

export function roundPaiseHalfUp(value: Decimal | number): number {
  const d = value instanceof Decimal ? value : new Decimal(value);
  return d.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
}

export type GstBreakup = { cgstPaise: number; sgstPaise: number; igstPaise: number };

/**
 * Split `amountPaise` at `rateBps` into CGST/SGST or IGST by place of supply.
 * Intra-state halves are rounded independently (FR-19 / AC-5).
 */
export function computeGst(
  amountPaise: number,
  rateBps: number,
  propertyState: string,
  placeOfSupplyState: string,
): GstBreakup {
  const total = new Decimal(amountPaise).times(rateBps).div(10_000);
  if (placeOfSupplyState === propertyState) {
    const half = total.div(2);
    return { cgstPaise: roundPaiseHalfUp(half), sgstPaise: roundPaiseHalfUp(half), igstPaise: 0 };
  }
  return { cgstPaise: 0, sgstPaise: 0, igstPaise: roundPaiseHalfUp(total) };
}
