"use server";

/**
 * Discount coupons (§11) — 06 T-C3/T-C4 (FR-27/28/29, AC-27..31). Management is
 * gated by `coupon:manage`; VALIDATION has no side effects (booking preview /
 * front-desk check); APPLY is atomic under a `SELECT … FOR UPDATE` row lock on
 * the coupon, so the usage limit is race-safe — concurrent redemptions of a
 * last-use coupon cannot both win (same integrity class as no-overbooking).
 */
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { authorize } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import { emitEvent } from "@/lib/events";
import { DomainError, ErrorCode, NotFoundError } from "@/lib/errors";
import { toResult, type Result } from "@/lib/result";
import { computeCouponDiscount, type CouponLike } from "./domain/coupon-discount";
import { discountLine } from "./domain/money";
import { placeOfSupply } from "./domain/gst";
import { billingDb, isUniqueViolation, loadFolioContext, withBillingContext } from "./internal";
import { createCouponSchema, applyCouponSchema, validateCouponSchema } from "./schema";

/** Create a coupon (FR-27, AC-31). Requires `coupon:manage`. */
export async function createCoupon(input: unknown): Promise<Result<{ id: string; code: string }>> {
  return toResult(async () => {
    const data = createCouponSchema.parse(input);
    const user = await requireUser();
    authorize(user, "coupon:manage", null);
    const client = billingDb(user);

    return withBillingContext(user, () =>
      client.$transaction(async (tx) => {
        let coupon;
        try {
          coupon = await tx.coupon.create({
            data: { orgId: user.orgId, ...data, createdById: user.userId },
            select: { id: true, code: true },
          });
        } catch (e) {
          if (isUniqueViolation(e)) throw new DomainError(ErrorCode.CONFLICT, "A coupon with that code already exists.", { publicMessage: "That coupon code is already in use." });
          throw e;
        }
        await writeAudit(tx, { action: "coupon:create", entityType: "Coupon", entityId: coupon.id, propertyId: null, after: { code: coupon.code } });
        return coupon;
      }),
    );
  });
}

/** Pause / expire a coupon (FR-27). Requires `coupon:manage`. */
async function setCouponStatus(input: unknown, status: "PAUSED" | "EXPIRED", action: string): Promise<Result<{ id: string }>> {
  return toResult(async () => {
    const { couponId } = z.object({ couponId: z.string().min(1) }).parse(input);
    const user = await requireUser();
    authorize(user, "coupon:manage", null);
    const client = billingDb(user);
    const coupon = await client.coupon.findFirst({ where: { id: couponId, orgId: user.orgId }, select: { id: true } });
    if (!coupon) throw new NotFoundError("Coupon not found.");
    return withBillingContext(user, () =>
      client.$transaction(async (tx) => {
        await tx.coupon.updateMany({ where: { id: couponId }, data: { status } });
        await writeAudit(tx, { action, entityType: "Coupon", entityId: couponId, propertyId: null, after: { status } });
        return { id: couponId };
      }),
    );
  });
}
export const pauseCoupon = (input: unknown) => setCouponStatus(input, "PAUSED", "coupon:pause");
export const expireCoupon = (input: unknown) => setCouponStatus(input, "EXPIRED", "coupon:expire");

type CouponRow = CouponLike & {
  id: string; status: string; validFrom: Date; validTo: Date; usageLimit: number | null;
  usageLimitPerGuest: number; timesUsed: number; appliesToPropertyIds: string[]; appliesToCategoryIds: string[];
};

/** Assert a coupon is redeemable for the context; returns it + the discount. Pure-ish (a read). */
function assertRedeemable(coupon: CouponRow, ctx: { bookingPaise: number; propertyId: string; categoryId?: string; now: Date }): number {
  if (coupon.status !== "ACTIVE") throw new DomainError(ErrorCode.COUPON_INVALID);
  if (ctx.now < coupon.validFrom || ctx.now > coupon.validTo) throw new DomainError(ErrorCode.COUPON_INVALID);
  if (coupon.appliesToPropertyIds.length > 0 && !coupon.appliesToPropertyIds.includes(ctx.propertyId)) throw new DomainError(ErrorCode.COUPON_INELIGIBLE);
  if (coupon.appliesToCategoryIds.length > 0 && ctx.categoryId && !coupon.appliesToCategoryIds.includes(ctx.categoryId)) throw new DomainError(ErrorCode.COUPON_INELIGIBLE);
  if (ctx.bookingPaise < coupon.minBookingPaise) throw new DomainError(ErrorCode.COUPON_INELIGIBLE);
  const discount = computeCouponDiscount(coupon, ctx.bookingPaise);
  if (discount <= 0) throw new DomainError(ErrorCode.COUPON_INELIGIBLE);
  return discount;
}

/** Validate a coupon with NO side effects (FR-27, AC-27). */
export async function validateCoupon(input: unknown): Promise<Result<{ discountPaise: number }>> {
  return toResult(async () => {
    const data = validateCouponSchema.parse(input);
    const user = await requireUser();
    const client = billingDb(user);
    const coupon = (await client.coupon.findFirst({ where: { orgId: user.orgId, code: data.code } })) as CouponRow | null;
    if (!coupon) throw new DomainError(ErrorCode.COUPON_INVALID);
    const discount = assertRedeemable(coupon, { bookingPaise: data.bookingPaise, propertyId: data.propertyId, categoryId: data.categoryId, now: new Date() });
    return { discountPaise: discount };
  });
}

/** Apply a coupon to a folio ATOMICALLY (FR-28, AC-28/29/30). No special permission (AC-31). */
export async function applyCoupon(input: unknown): Promise<Result<{ redemptionId: string; discountPaise: number }>> {
  return toResult(async () => {
    const data = applyCouponSchema.parse(input);
    const user = await requireUser();
    const client = billingDb(user);
    const ctx = await loadFolioContext(client, data.folioId);
    if (!ctx) throw new NotFoundError("Folio not found.");

    return withBillingContext(user, () =>
      client.$transaction(async (tx) => {
        // Row-lock the coupon so the usage-limit check-and-increment is race-safe.
        const locked = await (tx as unknown as Prisma.TransactionClient).$queryRaw<{ id: string }[]>`
          SELECT "id" FROM "Coupon" WHERE "orgId" = ${user.orgId} AND "code" = ${data.code} FOR UPDATE
        `;
        if (!locked[0]) throw new DomainError(ErrorCode.COUPON_INVALID);

        const coupon = (await tx.coupon.findUniqueOrThrow({ where: { id: locked[0].id } })) as CouponRow;
        const discount = assertRedeemable(coupon, { bookingPaise: data.bookingPaise, propertyId: data.propertyId, categoryId: undefined, now: new Date() });

        // Usage limits (checked under the lock).
        if (coupon.usageLimit != null && coupon.timesUsed >= coupon.usageLimit) {
          throw new DomainError(ErrorCode.COUPON_EXHAUSTED);
        }
        const guestUses = await tx.couponRedemption.count({ where: { couponId: coupon.id, guestId: data.guestId } });
        if (guestUses >= coupon.usageLimitPerGuest) throw new DomainError(ErrorCode.COUPON_EXHAUSTED);

        await tx.coupon.updateMany({ where: { id: coupon.id }, data: { timesUsed: { increment: 1 } } });

        let redemption;
        try {
          redemption = await tx.couponRedemption.create({
            data: { couponId: coupon.id, guestId: data.guestId, reservationId: data.reservationId ?? null, folioId: data.folioId, discountPaise: discount },
            select: { id: true },
          });
        } catch (e) {
          if (isUniqueViolation(e)) throw new DomainError(ErrorCode.COUPON_EXHAUSTED, "Already redeemed for this reservation.");
          throw e;
        }

        // Pre-tax DISCOUNT line (GST recomputed via negated proportional split).
        const pos = placeOfSupply("ROOM", ctx.propertyState, ctx.billToState);
        const draft = discountLine(discount, 1200, ctx.propertyState, pos, "PRE_TAX");
        await tx.folioLine.create({
          data: {
            folioId: data.folioId, type: "DISCOUNT", description: `Coupon ${data.code}`,
            quantity: 1, unitPaise: draft.amountPaise, amountPaise: BigInt(draft.amountPaise),
            taxRateBps: draft.taxRateBps, cgstPaise: draft.cgstPaise, sgstPaise: draft.sgstPaise, igstPaise: draft.igstPaise,
            placeOfSupplyState: pos, businessDate: new Date(), postedById: user.userId,
          },
        });

        await emitEvent(tx, { type: "CouponRedeemed", aggregateId: coupon.id, propertyId: ctx.propertyId, payload: { code: data.code, discountPaise: discount, folioId: data.folioId } });
        await writeAudit(tx, { action: "coupon:redeem", entityType: "Coupon", entityId: coupon.id, propertyId: ctx.propertyId, after: { code: data.code, discountPaise: discount } });
        return { redemptionId: redemption.id, discountPaise: discount };
      }),
    );
  });
}
