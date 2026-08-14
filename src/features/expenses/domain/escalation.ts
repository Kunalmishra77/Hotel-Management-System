/**
 * Expense approval escalation (Phase 6) — pure. A spend over the threshold is a
 * "major" expense that only Super Admin (Administrator, via `expense:approve-large`)
 * may approve; at or below it, a Manager's `expense:approve` suffices.
 */

/** ₹25,000. Config-worthy later; a constant for now (documented in the spec). */
export const EXPENSE_ESCALATION_THRESHOLD_PAISE = 2_500_000;

/** True when the amount requires Super-Admin approval. */
export function requiresSuperApproval(amountPaise: number): boolean {
  return amountPaise > EXPENSE_ESCALATION_THRESHOLD_PAISE;
}
