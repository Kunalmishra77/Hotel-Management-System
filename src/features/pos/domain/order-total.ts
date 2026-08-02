/**
 * Order total — 19 POS T-3 (FR-2, AC-1). Pure. The order subtotal is DERIVED from
 * its lines and never trusted from the client (business-rules.md §21). Each line's
 * `amountPaise = quantity × unitPaise`; the subtotal is their sum.
 */

export type OrderLine = {
  quantity: number;
  unitPaise: number;
};

/** The amount a single line contributes (quantity × unit), in paise. */
export function lineAmountPaise(line: OrderLine): number {
  return line.quantity * line.unitPaise;
}

/** Derived order subtotal (Σ line amounts), in paise. */
export function orderTotal(lines: readonly OrderLine[]): { subtotalPaise: number } {
  const subtotalPaise = lines.reduce((sum, l) => sum + lineAmountPaise(l), 0);
  return { subtotalPaise };
}
