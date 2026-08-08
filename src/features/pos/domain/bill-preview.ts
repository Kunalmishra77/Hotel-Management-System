/**
 * Bill preview — 19 POS T-4 (FR-3/4, AC-2/3). Pure. Uses the SHARED `lib/tax`
 * split (the same formula 06 posts with), so the preview a guest sees equals the
 * folio line 06 will write.
 *
 * GST is computed PER RATE-GROUP by HSN/SAC rate (FR-4). An order-level discount
 * is applied PRE-TAX and apportioned across groups in proportion to their
 * subtotal, so the discounted taxable value carries the correct GST.
 *
 * Place of supply is NOT a caller argument: POS F&B is consumed on-premise, so it
 * is pinned to the property's state → the split is ALWAYS CGST+SGST and `igst` is
 * always 0 (business-rules.md §10). The `igstPaise` key stays in the shape only so
 * POS and 06 can share one bill type.
 */
import { splitPosGst, roundOffToRupee } from "@/lib/tax";
import { groupPosChargeLines } from "./charge-lines";

export type BillLine = {
  quantity: number;
  unitPaise: number;
  /** GST rate in basis points (e.g. 500 = 5%). Config-driven per menu item (FR-4). */
  gstBps: number;
};

export type BillPreview = {
  subtotalPaise: number;
  discountPaise: number;
  cgstPaise: number;
  sgstPaise: number;
  /** Always 0 for POS (on-premise); kept so the shape matches 06's bill type. */
  igstPaise: number;
  roundOffPaise: number;
  totalPaise: number;
};

/**
 * Compute the live bill for an order.
 *
 * @param lines          the order's items (quantity, unit, gst rate)
 * @param discountPaise  a pre-tax, order-level discount (≥ 0, ≤ subtotal)
 * @param propertyState  the property's state — the on-premise place of supply
 */
export function billPreview(
  lines: readonly BillLine[],
  discountPaise: number,
  propertyState: string,
): BillPreview {
  const subtotalPaise = lines.reduce((s, l) => s + l.quantity * l.unitPaise, 0);
  const discount = Math.min(Math.max(discountPaise, 0), subtotalPaise);

  // Group taxable value by GST rate (discount apportioned, last group absorbs the
  // remainder) via the SAME fn the folio posting uses — so preview == folio.
  let cgst = 0;
  let sgst = 0;
  let igst = 0;
  for (const g of groupPosChargeLines(lines, discountPaise)) {
    const gst = splitPosGst(g.taxablePaise, g.gstBps, propertyState);
    cgst += gst.cgstPaise;
    sgst += gst.sgstPaise;
    igst += gst.igstPaise;
  }

  const grand = subtotalPaise - discount + cgst + sgst + igst;
  const { roundOffPaise, totalPaise } = roundOffToRupee(grand);

  return { subtotalPaise, discountPaise: discount, cgstPaise: cgst, sgstPaise: sgst, igstPaise: igst, roundOffPaise, totalPaise };
}
