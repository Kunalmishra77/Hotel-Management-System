/**
 * gstInclusiveDisplay — 23 T-5 (FR-3/15, AC-1/18). Pure: the GST-INCLUSIVE
 * amount a public guest sees, computed from the resolved room rate, the number
 * of nights, and the category's GST slab (`RoomCategory.gstBps`).
 *
 * business-rules.md §15/§21: what is displayed must equal what is charged — so
 * this same figure is the amount the deposit is taken against and the amount the
 * folio must reconcile to. 23 renders a GST-INCLUSIVE total only; it makes NO
 * CGST-vs-IGST decision (accommodation is on-premise → always CGST+SGST, split
 * authoritatively by 06 at folio time from `placeOfSupply = property state`).
 *
 * Rounding is half-up to the paisa on the tax component, matching 06's
 * line-level rounding, so the inclusive total 06 later reconstructs is identical.
 */
import Decimal from "decimal.js";

export type GstDisplay = {
  /** rate × nights × rooms, before tax (paise). */
  netPaise: number;
  /** The GST amount added on top (paise). */
  taxPaise: number;
  /** netPaise + taxPaise — the figure shown to the guest and charged (paise). */
  grossPaise: number;
};

export function gstInclusiveDisplay(
  ratePaise: number,
  nights: number,
  gstBps: number,
  rooms = 1,
): GstDisplay {
  const net = new Decimal(ratePaise).times(nights).times(rooms);
  const tax = net.times(gstBps).div(10_000).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  const netPaise = net.toNumber();
  const taxPaise = tax.toNumber();
  return { netPaise, taxPaise, grossPaise: netPaise + taxPaise };
}
