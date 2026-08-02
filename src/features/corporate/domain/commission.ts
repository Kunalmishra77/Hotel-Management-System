/**
 * 25 travel-agent commission — T-5 (FR-6, AC-6). PURE, BigInt paise.
 *
 * Commission is `roomRevenue × bps ÷ 10000`, computed with Decimal.js and
 * rounded half-up to the paisa (data-model.md money rule). It applies ONLY to
 * attributed ROOM revenue — never tax, F&B or other charges (design.md edge case).
 */
import Decimal from "decimal.js";

/** Commission (paise) on a single room-revenue total at `bps` basis points. */
export function commissionOnRevenue(roomRevenuePaise: bigint, bps: number): bigint {
  if (bps <= 0 || roomRevenuePaise <= 0n) return 0n;
  const paise = new Decimal(roomRevenuePaise.toString())
    .times(bps)
    .div(10_000)
    .toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  return BigInt(paise.toFixed(0));
}

/**
 * Total commission payable across an agent's attributed bookings: sum the room
 * revenue first, then apply the rate once (so per-line rounding never drifts).
 */
export function commissionPayable(
  bookings: readonly { roomRevenuePaise: bigint }[],
  bps: number,
): bigint {
  const total = bookings.reduce(
    (sum, b) => sum + (b.roomRevenuePaise > 0n ? b.roomRevenuePaise : 0n),
    0n,
  );
  return commissionOnRevenue(total, bps);
}
