/**
 * computeCouponDiscount — 06 T-C2 (FR-27, AC-27). Pure: given a coupon and a
 * booking value, the discount in paise. Eligibility gates (status, window, usage
 * limits, property/category) are enforced transactionally in `applyCoupon`; the
 * only gate here is `minBookingPaise` (a value, not a side-effect).
 */
import Decimal from "decimal.js";
import { roundPaiseHalfUp } from "./gst";

export type CouponLike = {
  discountType: "PERCENT" | "FIXED";
  discountBps: number | null;
  discountPaise: number | null;
  maxDiscountPaise: number | null;
  minBookingPaise: number;
};

export function computeCouponDiscount(coupon: CouponLike, bookingPaise: number): number {
  if (bookingPaise < coupon.minBookingPaise) return 0;

  if (coupon.discountType === "PERCENT") {
    const raw = roundPaiseHalfUp(new Decimal(bookingPaise).times(coupon.discountBps ?? 0).div(10_000));
    const capped = coupon.maxDiscountPaise != null ? Math.min(raw, coupon.maxDiscountPaise) : raw;
    return Math.max(0, capped);
  }
  // FIXED — never more than the booking value.
  return Math.max(0, Math.min(coupon.discountPaise ?? 0, bookingPaise));
}
