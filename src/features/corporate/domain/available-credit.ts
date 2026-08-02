/**
 * 25 corporate-credit domain — T-3 (FR-3, AC-3/4). PURE, BigInt paise.
 *
 * This is the ONE predicate the atomic `reserveCredit` (index.ts) applies while
 * holding the `SELECT … FOR UPDATE` row lock, so "available credit" is defined
 * once and can never diverge between the check and any report that displays it.
 */

/**
 * Head-room left on a corporate's credit line: `limit − receivable`, floored at
 * zero (an over-limit account — should never happen under the lock — reads as 0
 * available, never negative).
 */
export function availableCredit(limitPaise: bigint, receivablePaise: bigint): bigint {
  const avail = limitPaise - receivablePaise;
  return avail > 0n ? avail : 0n;
}

/**
 * Would reserving `amountPaise` push the receivable past the limit? The exact
 * test `reserveCredit` makes under the row lock: `receivable + amount > limit`.
 */
export function exceedsLimit(
  limitPaise: bigint,
  receivablePaise: bigint,
  amountPaise: bigint,
): boolean {
  return receivablePaise + amountPaise > limitPaise;
}
