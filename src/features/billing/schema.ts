/**
 * Billing input schemas (zod) — 06. Every money boundary validated. Amounts are
 * integer paise and must be positive where a positive amount is required (FR-23,
 * AC-25); direction (refund) is a flag, never a sign.
 */
import { z } from "zod";

const positivePaise = z.number().int().positive();
const chargeType = z.enum([
  "ROOM", "FOOD", "LAUNDRY", "AIRPORT_TRANSFER", "TAXI", "KITCHEN",
  "EXTRA_BED", "POS", "MISC",
]);
const paymentMode = z.enum([
  "CASH", "CREDIT_CARD", "DEBIT_CARD", "UPI", "BANK_TRANSFER", "ONLINE", "CORPORATE_CREDIT",
]);

export const postChargeSchema = z.object({
  folioId: z.string().min(1),
  type: chargeType,
  description: z.string().min(1).max(200),
  quantity: z.number().int().positive().default(1),
  unitPaise: positivePaise,
  hsnSac: z.string().max(12).optional(),
  /**
   * Explicit GST rate override (bps). Omit for the type-derived rate (the norm);
   * POS passes the menu item's own rate so a mixed-slab order posts one line per
   * rate at its true rate (19 R-35). Bounded like other rate inputs.
   */
  taxRateBps: z.number().int().min(0).max(5000).optional(),
  placeOfSupplyState: z.string().max(60).optional(),
  businessDate: z.coerce.date().optional(),
});
export type PostChargeInput = z.infer<typeof postChargeSchema>;

export const applyDiscountSchema = z.object({
  folioId: z.string().min(1),
  amountPaise: positivePaise,
  reason: z.string().min(1).max(300),
  mode: z.enum(["PRE_TAX", "FINANCIAL"]).default("PRE_TAX"),
  rateBps: z.number().int().min(0).max(5000).default(1200),
});

export const reverseLineSchema = z.object({
  lineId: z.string().min(1),
  reason: z.string().min(1).max(300),
});

export const recordPaymentSchema = z.object({
  folioId: z.string().min(1),
  tenders: z.array(z.object({ mode: paymentMode, amountPaise: positivePaise, reference: z.string().max(100).optional() })).min(1),
  // When given, the tenders MUST sum to it (the take-payment "remaining → 0" gate, AC-8/9).
  expectedTotalPaise: positivePaise.optional(),
});
export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>;

export const refundSchema = z.object({
  folioId: z.string().min(1),
  amountPaise: positivePaise,
  mode: paymentMode.default("CASH"),
  reason: z.string().min(1).max(300),
});

export const generateInvoiceSchema = z.object({
  folioId: z.string().min(1),
  customerName: z.string().min(1).max(200),
  customerGstin: z.string().max(20).optional(),
  billToState: z.string().max(60).optional(),
  type: z.enum(["TAX_INVOICE", "CREDIT_NOTE"]).default("TAX_INVOICE"),
  cancelsInvoiceId: z.string().optional(),
});
export type GenerateInvoiceInput = z.infer<typeof generateInvoiceSchema>;

export const voidInvoiceSchema = z.object({
  invoiceId: z.string().min(1),
  reason: z.string().min(1).max(300),
});

export const settleCorporateSchema = z.object({
  folioId: z.string().min(1),
  corporateId: z.string().min(1),
});

export const postRoomChargesSchema = z.object({
  propertyId: z.string().min(1),
  businessDate: z.coerce.date(),
});

// Coupons
export const createCouponSchema = z.object({
  code: z.string().min(2).max(40),
  description: z.string().max(200).optional(),
  discountType: z.enum(["PERCENT", "FIXED"]),
  discountBps: z.number().int().min(0).max(10000).optional(),
  discountPaise: z.number().int().min(0).optional(),
  maxDiscountPaise: z.number().int().min(0).optional(),
  minBookingPaise: z.number().int().min(0).default(0),
  validFrom: z.coerce.date(),
  validTo: z.coerce.date(),
  usageLimit: z.number().int().positive().optional(),
  usageLimitPerGuest: z.number().int().positive().default(1),
  appliesToPropertyIds: z.array(z.string()).default([]),
  appliesToCategoryIds: z.array(z.string()).default([]),
});

export const applyCouponSchema = z.object({
  folioId: z.string().min(1),
  code: z.string().min(2).max(40),
  guestId: z.string().min(1),
  bookingPaise: z.number().int().positive(),
  propertyId: z.string().min(1),
  reservationId: z.string().optional(),
});

export const validateCouponSchema = z.object({
  code: z.string().min(2).max(40),
  guestId: z.string().min(1),
  bookingPaise: z.number().int().positive(),
  propertyId: z.string().min(1),
  categoryId: z.string().optional(),
});
