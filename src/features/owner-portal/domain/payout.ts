/**
 * 27 owner-portal — payout math (FR-11). PURE and deterministic.
 *
 * Management-fee model: the operator earns a fee = feeBps of REVENUE; the owner
 * receives revenue minus operating expenses minus that fee. Net may be negative
 * in a loss month — it is a real shortfall, never clamped to zero.
 *
 * Money is integer paise; the fee is computed with Decimal.js and rounded
 * half-up to the paisa (data-model.md).
 */
import Decimal from "decimal.js";

export type PayoutComputation = {
  managementFeePaise: bigint;
  netPayablePaise: bigint;
};

/**
 * @param revenuePaise  tax-excluded revenue for the period (reporting.md)
 * @param expensePaise  operating expenses for the period (07 approved + payroll)
 * @param feeBps        management fee in basis points of revenue (1500 = 15%)
 */
export function computePayout(revenuePaise: bigint, expensePaise: bigint, feeBps: number): PayoutComputation {
  const fee = new Decimal(revenuePaise.toString())
    .times(feeBps)
    .div(10_000)
    .toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  const managementFeePaise = BigInt(fee.toFixed(0));
  const netPayablePaise = revenuePaise - expensePaise - managementFeePaise;
  return { managementFeePaise, netPayablePaise };
}

/** First day (UTC) of the month a date falls in — the payout period key. */
export function monthStart(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

/** Last day (UTC) of that month — the inclusive period end for the report range. */
export function monthEnd(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
}
