/**
 * Manual bill lines — specs/06 FR-MB-1. Pure: turns what staff typed (rate, qty,
 * GST %, inclusive or not) into folio-line money. On-premise supply → CGST + SGST
 * at the property's state (business-rules §10). An inclusive figure bills EXACTLY
 * that total (₹2,400 incl. = ₹2,400.00), like room rates do.
 */
import Decimal from "decimal.js";
import { computeGst, exactInclusive, roundPaiseHalfUp } from "./gst";

export type ManualLineInput = {
  description: string;
  hsnSac?: string | null;
  quantity: number;
  /** Per unit, as typed (GST-inclusive when `inclusive`). */
  ratePaise: number;
  gstBps: number;
  inclusive: boolean;
};

export type ManualLine = {
  description: string; hsnSac: string | null; quantity: number; unitPaise: number; amountPaise: number;
  taxRateBps: number; cgstPaise: number; sgstPaise: number; igstPaise: number;
};

export function manualLine(input: ManualLineInput, propertyState: string): ManualLine {
  const gross = input.ratePaise * input.quantity;
  let amount = gross;
  if (input.inclusive && input.gstBps > 0) {
    const candidate = roundPaiseHalfUp(new Decimal(gross).times(10_000).div(10_000 + input.gstBps));
    amount = exactInclusive(gross, input.gstBps, candidate);
  }
  const gst = computeGst(amount, input.gstBps, propertyState, propertyState);
  return {
    description: input.description.trim(),
    hsnSac: input.hsnSac?.trim() || null,
    quantity: input.quantity,
    unitPaise: roundPaiseHalfUp(new Decimal(amount).div(input.quantity)),
    amountPaise: amount,
    taxRateBps: input.gstBps,
    ...gst,
  };
}

export function manualBillTotal(lines: ManualLine[]): number {
  return lines.reduce((n, l) => n + l.amountPaise + l.cgstPaise + l.sgstPaise + l.igstPaise, 0);
}

/**
 * Paise to add as a "Round off" line so the bill totals EXACTLY what was typed for
 * the inclusive lines (some totals have no exact pre-tax value at 12%/18%: CGST and
 * SGST round separately). Exclusive lines are taken as computed.
 */
export function manualRoundOff(inputs: ManualLineInput[], lines: ManualLine[]): number {
  let diff = 0;
  inputs.forEach((inp, i) => {
    const l = lines[i];
    if (!l || !inp.inclusive) return;
    diff += inp.ratePaise * inp.quantity - (l.amountPaise + l.cgstPaise + l.sgstPaise + l.igstPaise);
  });
  return diff;
}
