/**
 * 20 addendum — laundry linen reconciliation (FR-8). PURE and deterministic.
 *
 * Linen is sent to the laundry and (mostly) returned; the balance is what didn't
 * come back. A small mismatch is tolerated (items in transit / miscount); beyond
 * the per-line tolerance it is a real SHORT that staff must chase.
 *
 * Quantities are integer counts (pieces) — never money.
 */

export type LaundryLineStatus = "OK" | "SHORT" | "PENDING";

export type LaundryLineResult = {
  /** sentQty − returnedQty (can be negative if more came back than went out). */
  balance: number;
  status: LaundryLineStatus;
};

/**
 * Reconcile one linen line. `returnedRecorded` distinguishes "no returns entered
 * yet" (PENDING) from "0 returned" (a real shortage) — a caller passes it false
 * until the return is recorded.
 */
export function laundryLineStatus(
  sentQty: number,
  returnedQty: number,
  toleranceQty: number,
  returnedRecorded: boolean,
): LaundryLineResult {
  const balance = sentQty - returnedQty;
  if (!returnedRecorded) return { balance, status: "PENDING" };
  // Within tolerance (in either direction) is OK; a positive balance beyond
  // tolerance is a shortage.
  const status: LaundryLineStatus = Math.abs(balance) <= Math.max(0, toleranceQty) ? "OK" : balance > 0 ? "SHORT" : "OK";
  return { balance, status };
}

export type LaundryBatchTotals = { sent: number; returned: number; balance: number; anyShort: boolean };

/** Roll a batch's lines into headline totals for the register. */
export function laundryBatchTotals(
  lines: { sentQty: number; returnedQty: number; toleranceQty: number }[],
  returnsRecorded: boolean,
): LaundryBatchTotals {
  let sent = 0;
  let returned = 0;
  let anyShort = false;
  for (const l of lines) {
    sent += l.sentQty;
    returned += l.returnedQty;
    if (laundryLineStatus(l.sentQty, l.returnedQty, l.toleranceQty, returnsRecorded).status === "SHORT") anyShort = true;
  }
  return { sent, returned, balance: sent - returned, anyShort };
}
