/**
 * 25 receivables aging — T-4 (FR-2/7, AC-7). PURE, BigInt paise.
 *
 * Given the dated charges that make up a corporate's receivable and the total
 * already paid against the account, allocate payments to the OLDEST charges
 * first (FIFO — the standard receivables convention) and bucket what remains
 * unpaid by age relative to `asOf`: 0-30 / 31-60 / 61-90 / 90+ days.
 */

export type AgingCharge = {
  /** The charge amount owed (paise); non-positive charges are ignored. */
  amountPaise: bigint;
  /** When the charge was raised (settlement date), for age computation. */
  date: Date;
};

export type AgingBuckets = {
  /** 0–30 days. */ current: bigint;
  days31to60: bigint;
  days61to90: bigint;
  /** 90+ days. */ days90plus: bigint;
  /** Σ of the four buckets = the unpaid remainder. */ totalPaise: bigint;
};

const DAY_MS = 86_400_000;

/**
 * Bucket the unpaid remainder of `charges` by age.
 *
 * `paidPaise` (Σ payments/releases against the account) is applied FIFO to the
 * oldest charges before ageing, so a recent payment clears the stalest debt
 * first — matching how `releaseCredit` reduces the receivable overall.
 */
export function aging(charges: AgingCharge[], paidPaise: bigint, asOf: Date): AgingBuckets {
  const sorted = [...charges]
    .filter((c) => c.amountPaise > 0n)
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  let remainingPayment = paidPaise > 0n ? paidPaise : 0n;
  const buckets: AgingBuckets = {
    current: 0n,
    days31to60: 0n,
    days61to90: 0n,
    days90plus: 0n,
    totalPaise: 0n,
  };

  for (const c of sorted) {
    let owed = c.amountPaise;
    if (remainingPayment > 0n) {
      const applied = remainingPayment >= owed ? owed : remainingPayment;
      owed -= applied;
      remainingPayment -= applied;
    }
    if (owed <= 0n) continue;

    const ageDays = Math.floor((asOf.getTime() - c.date.getTime()) / DAY_MS);
    if (ageDays <= 30) buckets.current += owed;
    else if (ageDays <= 60) buckets.days31to60 += owed;
    else if (ageDays <= 90) buckets.days61to90 += owed;
    else buckets.days90plus += owed;
    buckets.totalPaise += owed;
  }

  return buckets;
}
