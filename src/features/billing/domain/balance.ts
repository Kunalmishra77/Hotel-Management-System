/**
 * Folio balance derivation — 06 T-5 (FR-3/10, AC-2/11). The SINGLE definition of
 * a folio's balance; there is no stored balance column (business-rules.md §6).
 *
 *   balance = Σ(line.amount + cgst + sgst + igst) − Σ(non-refund) + Σ(refund)
 *
 * Payments are stored POSITIVE with `isRefund` carrying direction, so a refund is
 * added back to the balance (the guest owes it again / it left the till). BigInt
 * throughout — folio totals accumulate (banquets, long stays) beyond safe-int.
 */
export type BalanceLine = {
  amountPaise: bigint | number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
};
export type BalancePayment = { amountPaise: bigint | number; isRefund: boolean };

export function folioBalance(lines: BalanceLine[], payments: BalancePayment[]): bigint {
  let charges = 0n;
  for (const l of lines) {
    charges += BigInt(l.amountPaise) + BigInt(l.cgstPaise) + BigInt(l.sgstPaise) + BigInt(l.igstPaise);
  }
  let paid = 0n;
  for (const p of payments) {
    paid += p.isRefund ? -BigInt(p.amountPaise) : BigInt(p.amountPaise);
  }
  return charges - paid;
}

/** Net actually paid = Σ non-refund − Σ refund (the cap a further refund can't exceed). */
export function netPaid(payments: BalancePayment[]): bigint {
  let net = 0n;
  for (const p of payments) net += p.isRefund ? -BigInt(p.amountPaise) : BigInt(p.amountPaise);
  return net;
}

/** A refund is allowed only up to what is still net-paid (FR-10/23, AC-11). */
export function refundWithinNetPaid(refundPaise: bigint | number, payments: BalancePayment[]): boolean {
  return BigInt(refundPaise) <= netPaid(payments);
}
