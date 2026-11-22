/**
 * What an OTA keeps from a booking (client, 22 Nov 2026: "how much is MMT
 * charging us?"). Pure. Per channel the hotel sets the commission % (on the
 * pre-GST value, or on the GST-inclusive value if that's how the OTA bills), GST
 * on that commission (18%, claimable as ITC), and the statutory TCS (CGST Act §52,
 * 0.5% of the net taxable value) and TDS (Income-tax §194-O, 0.1%) the OTA
 * withholds — both credited to the hotel later. Rounded half-up per booking.
 */
import Decimal from "decimal.js";

export type DeductionRule = {
  commissionBps: number;
  /** Commission on the GST-inclusive amount instead of the pre-GST value. */
  commissionOnGross: boolean;
  gstOnCommissionBps: number;
  tcsBps: number;
  tdsBps: number;
};

/** Until the hotel enters a channel's commission: none (never a guessed figure);
 *  TCS / TDS at the statutory rates, editable. */
export const DEFAULT_DEDUCTION: DeductionRule = { commissionBps: 0, commissionOnGross: false, gstOnCommissionBps: 1800, tcsBps: 50, tdsBps: 10 };

export type Deduction = {
  grossPaise: number; commissionPaise: number; gstOnCommissionPaise: number; tcsPaise: number; tdsPaise: number;
  deductionPaise: number; netPaise: number;
};

const pct = (paise: number | Decimal, bps: number) => new Decimal(paise).times(bps).div(10_000).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();

export function otaDeduction(basePaise: number, gstPaise: number, rule: DeductionRule): Deduction {
  const gross = basePaise + gstPaise;
  const commission = pct(rule.commissionOnGross ? gross : basePaise, rule.commissionBps);
  const gstOnCommission = pct(commission, rule.gstOnCommissionBps);
  const tcs = pct(basePaise, rule.tcsBps);
  const tds = pct(basePaise, rule.tdsBps);
  const deduction = commission + gstOnCommission + tcs + tds;
  return { grossPaise: gross, commissionPaise: commission, gstOnCommissionPaise: gstOnCommission, tcsPaise: tcs, tdsPaise: tds, deductionPaise: deduction, netPaise: gross - deduction };
}

export function addDeduction(a: Deduction, b: Deduction): Deduction {
  return {
    grossPaise: a.grossPaise + b.grossPaise, commissionPaise: a.commissionPaise + b.commissionPaise,
    gstOnCommissionPaise: a.gstOnCommissionPaise + b.gstOnCommissionPaise, tcsPaise: a.tcsPaise + b.tcsPaise,
    tdsPaise: a.tdsPaise + b.tdsPaise, deductionPaise: a.deductionPaise + b.deductionPaise, netPaise: a.netPaise + b.netPaise,
  };
}
export const ZERO_DEDUCTION: Deduction = { grossPaise: 0, commissionPaise: 0, gstOnCommissionPaise: 0, tcsPaise: 0, tdsPaise: 0, deductionPaise: 0, netPaise: 0 };
