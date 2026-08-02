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
import Decimal from "decimal.js";
import { splitPosGst, roundOffToRupee } from "@/lib/tax";

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

  // Group taxable value by GST rate so each rate is split independently.
  const byRate = new Map<number, number>();
  for (const l of lines) {
    const amount = l.quantity * l.unitPaise;
    byRate.set(l.gstBps, (byRate.get(l.gstBps) ?? 0) + amount);
  }

  let cgst = 0;
  let sgst = 0;
  let igst = 0;
  let apportioned = 0;
  const groups = [...byRate.entries()];
  groups.forEach(([gstBps, groupSubtotal], idx) => {
    // Apportion the discount by subtotal share; the LAST group absorbs the
    // rounding remainder so Σ apportioned == discount exactly.
    let groupDiscount: number;
    if (idx === groups.length - 1) {
      // The last group absorbs the remainder (subtotal is > 0 whenever a group exists).
      groupDiscount = discount - apportioned;
    } else {
      groupDiscount = new Decimal(discount).times(groupSubtotal).div(subtotalPaise).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
      apportioned += groupDiscount;
    }
    const taxable = groupSubtotal - groupDiscount;
    const gst = splitPosGst(taxable, gstBps, propertyState);
    cgst += gst.cgstPaise;
    sgst += gst.sgstPaise;
    igst += gst.igstPaise;
  });

  const grand = subtotalPaise - discount + cgst + sgst + igst;
  const { roundOffPaise, totalPaise } = roundOffToRupee(grand);

  return { subtotalPaise, discountPaise: discount, cgstPaise: cgst, sgstPaise: sgst, igstPaise: igst, roundOffPaise, totalPaise };
}
