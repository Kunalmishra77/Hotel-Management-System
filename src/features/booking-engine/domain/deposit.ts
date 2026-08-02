/**
 * depositAmount — 23 T-3 (FR-5, AC-5). Pure: given the GST-inclusive booking
 * total and the property's deposit policy, the amount to charge online now.
 *
 * Policies (BookingEngineConfig.depositPolicy / depositValue):
 *   FULL  — charge the whole total; `depositValue` ignored.
 *   PCT   — charge `depositValue` BASIS POINTS of the total (10000 = 100%, so
 *           the default 2000 = 20%), rounded half-up to the paisa, clamped to
 *           [1, total].
 *   FIXED — charge exactly `depositValue` paise, clamped to [1, total].
 *
 * The deposit is never zero (a booking must move money to confirm) and never
 * exceeds the total (you cannot pre-charge more than the stay is worth).
 */
import Decimal from "decimal.js";

export type DepositPolicy = "FULL" | "PCT" | "FIXED";

export function depositAmount(
  totalPaise: number,
  policy: { depositPolicy: DepositPolicy; depositValue: number },
): number {
  if (totalPaise <= 0) return 0;

  let raw: number;
  switch (policy.depositPolicy) {
    case "FULL":
      raw = totalPaise;
      break;
    case "PCT":
      // depositValue is basis points (2000 → 20%). Round half-up to the paisa.
      raw = new Decimal(totalPaise)
        .times(policy.depositValue)
        .div(10_000)
        .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
        .toNumber();
      break;
    case "FIXED":
      raw = policy.depositValue;
      break;
    default:
      raw = totalPaise;
  }

  // A deposit must be a positive amount no larger than the total.
  return Math.max(1, Math.min(raw, totalPaise));
}
