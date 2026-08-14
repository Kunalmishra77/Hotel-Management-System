/**
 * Booking-engine input schemas (zod) — 23. Every public + staff boundary is
 * validated here (api-conventions.md). Public inputs are UNTRUSTED — parse first,
 * treat validated types as trusted inward. Dates arrive as ISO strings and are
 * coerced to `Date`; the property-timezone interpretation happens in the domain.
 */
import { z } from "zod";

/** GET availability query params (?in=&out=&adults=&children=&rooms=). */
export const availabilityQuerySchema = z.object({
  checkInDate: z.coerce.date(),
  checkOutDate: z.coerce.date(),
  adults: z.coerce.number().int().min(1).max(20).default(2),
  children: z.coerce.number().int().min(0).max(20).default(0),
  rooms: z.coerce.number().int().min(1).max(10).default(1),
});
export type AvailabilityQuery = z.infer<typeof availabilityQuerySchema>;

/** Guest-supplied contact + consent captured at checkout. */
const guestDetails = z.object({
  fullName: z.string().trim().min(1).max(120),
  mobile: z.string().trim().min(6).max(20),
  email: z.string().trim().email().max(160).optional(),
  city: z.string().trim().max(80).optional(),
  state: z.string().trim().max(80).optional(),
});

/**
 * POST hold body. `honeypot` MUST be empty (a bot fills every field);
 * `captchaToken` is verified server-side; `idempotencyKey` dedupes a double-tap.
 * `consentAccepted` + `consentVersion` capture DPDP + terms acceptance (FR-12).
 */
export const holdSchema = z.object({
  roomCategoryId: z.string().min(1),
  checkInDate: z.coerce.date(),
  checkOutDate: z.coerce.date(),
  adults: z.number().int().min(1).max(20).default(2),
  children: z.number().int().min(0).max(20).default(0),
  rooms: z.number().int().min(1).max(10).default(1),
  extraBed: z.boolean().default(false),
  guest: guestDetails,
  couponCode: z.string().trim().min(2).max(40).optional(),
  consentAccepted: z.boolean(),
  consentVersion: z.string().min(1).max(40),
  idempotencyKey: z.string().min(8).max(120),
  // Anti-bot signals (FR-11). Absent is fine; a FILLED honeypot is the signal.
  honeypot: z.string().max(200).optional(),
  captchaToken: z.string().max(4000).optional(),
  /**
   * How the guest wants to pay. Absent (the public route never sends it) keeps the
   * original PARTIAL/deposit-online behaviour. Only the signed-in guest booking
   * action sets this — PAY_AT_HOTEL confirms with no online payment, which must
   * never be reachable by an anonymous caller (it would let bots confirm free
   * inventory). See `placeHold`.
   */
  paymentPreference: z.enum(["PAY_NOW", "PARTIAL", "PAY_AT_HOTEL"]).optional(),
});
export type HoldInput = z.infer<typeof holdSchema>;
export type PaymentPreference = "PAY_NOW" | "PARTIAL" | "PAY_AT_HOTEL";

/** Coupon preview at checkout — no side effects (FR-23, AC-20). */
export const quoteSchema = z.object({
  roomCategoryId: z.string().min(1),
  checkInDate: z.coerce.date(),
  checkOutDate: z.coerce.date(),
  rooms: z.number().int().min(1).max(10).default(1),
  couponCode: z.string().trim().min(2).max(40).optional(),
});
export type QuoteInput = z.infer<typeof quoteSchema>;

/** Staff config update — gated on `bookingengine:manage` (FR-17, AC-19). */
export const updateConfigSchema = z.object({
  propertyId: z.string().min(1),
  slug: z.string().trim().min(3).max(80).regex(/^[a-z0-9-]+$/, "Use lowercase letters, numbers and hyphens.").optional(),
  onlineSellableCategoryIds: z.array(z.string().min(1)).optional(),
  depositPolicy: z.enum(["FULL", "PCT", "FIXED"]).optional(),
  depositValue: z.number().int().min(0).max(10_000_000).optional(),
  checkoutTtlMin: z.number().int().min(1).max(120).optional(),
  minLos: z.number().int().min(1).max(365).optional(),
  maxLos: z.number().int().min(1).max(365).nullable().optional(),
  leadTimeDays: z.number().int().min(0).max(365).optional(),
  maxRoomsPerBooking: z.number().int().min(1).max(20).optional(),
  cancelWindowHours: z.number().int().min(0).max(2160).optional(),
  gatewayProvider: z.string().max(40).nullable().optional(),
});
export type UpdateConfigInput = z.infer<typeof updateConfigSchema>;

export const publishSchema = z.object({
  propertyId: z.string().min(1),
  isPublished: z.boolean(),
});

/** Self-service cancel via signed link (FR-16). */
export const selfCancelSchema = z.object({
  token: z.string().min(10).max(600),
});
