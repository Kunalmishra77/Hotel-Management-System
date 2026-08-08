/**
 * Group an order's items into per-GST-rate folio charge lines — 19 addendum
 * (R-35 fix, FR-4). A mixed order (e.g. 5% food + 18% beverage) must post ONE
 * folio line per rate, each with the correct taxable value, rate and HSN — never
 * a single lump line at one rate.
 *
 * Pure. The order-level discount is apportioned across groups by subtotal share,
 * with the LAST group absorbing the rounding remainder so Σ(group taxable) ==
 * subtotal − discount exactly. This is the SAME apportionment `billPreview` uses
 * (it consumes this fn), so the folio lines equal the preview the guest saw.
 */
import Decimal from "decimal.js";

export type ChargeLineInput = {
  quantity: number;
  unitPaise: number;
  /** GST rate in basis points, config-driven per menu item (FR-4). */
  gstBps: number;
  hsnSac?: string | null;
};

export type ChargeLineGroup = {
  gstBps: number;
  /** Representative HSN for the group (first item's in that rate). */
  hsnSac: string | null;
  /** Pre-tax taxable value for this rate after the apportioned discount. */
  taxablePaise: number;
};

export function groupPosChargeLines(
  items: readonly ChargeLineInput[],
  discountPaise: number,
): ChargeLineGroup[] {
  const subtotalPaise = items.reduce((s, l) => s + l.quantity * l.unitPaise, 0);
  if (subtotalPaise <= 0) return [];
  const discount = Math.min(Math.max(discountPaise, 0), subtotalPaise);

  // Preserve first-seen order so the LAST group deterministically absorbs the
  // remainder (matches billPreview). First item in a rate contributes its HSN.
  const byRate = new Map<number, { subtotal: number; hsnSac: string | null }>();
  for (const l of items) {
    const amount = l.quantity * l.unitPaise;
    const existing = byRate.get(l.gstBps);
    if (existing) existing.subtotal += amount;
    else byRate.set(l.gstBps, { subtotal: amount, hsnSac: l.hsnSac ?? null });
  }

  const groups = [...byRate.entries()];
  let apportioned = 0;
  return groups.map(([gstBps, g], idx) => {
    const groupDiscount =
      idx === groups.length - 1
        ? discount - apportioned
        : new Decimal(discount).times(g.subtotal).div(subtotalPaise).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
    if (idx !== groups.length - 1) apportioned += groupDiscount;
    return { gstBps, hsnSac: g.hsnSac, taxablePaise: g.subtotal - groupDiscount };
  });
}
