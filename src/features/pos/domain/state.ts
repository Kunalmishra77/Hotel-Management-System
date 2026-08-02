/**
 * Order state machine — 19 POS T-5 (FR-10, AC-9). Pure.
 *
 * Lifecycle: OPEN → SETTLED → VOID. An OPEN order can be settled; only a SETTLED
 * order can be voided (a correction is a reversal, FR-11). A SETTLED order is
 * immutable — no item edits, no re-settle. Illegal transitions are rejected.
 *
 * NOTE: "SETTLING" is NOT a status. Exactly-one-wins under concurrency is a row
 * lock held during the settle transaction (design.md § Sequences), not an enum
 * value — the enum stays OPEN | SETTLED | VOID.
 */
export type OrderStatus = "OPEN" | "SETTLED" | "VOID";

const ALLOWED: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  OPEN: ["SETTLED"],
  SETTLED: ["VOID"],
  VOID: [],
};

/** True iff `to` is a legal next status from `from`. */
export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ALLOWED[from]?.includes(to) ?? false;
}

/** True iff an OPEN-only mutation (add/remove item, discount, settle) is allowed. */
export function isEditable(status: OrderStatus): boolean {
  return status === "OPEN";
}
