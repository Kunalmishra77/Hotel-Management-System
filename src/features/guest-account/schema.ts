/**
 * Zod boundary for guest-account actions (Phase 2). Every guest-auth entry point
 * validates here first; validated types are trusted inward.
 */
import { z } from "zod";
import { isValidIndianMobile } from "@/features/guests/domain/normalize";

/** Consumer-grade minimum. Length is the only hard rule (NIST-style). */
export const GUEST_PASSWORD_MIN_LENGTH = 8;

const mobile = z
  .string()
  .trim()
  .min(1, "Enter your mobile number.")
  .refine(isValidIndianMobile, "Enter a valid 10-digit Indian mobile number.");

const email = z
  .string()
  .trim()
  .min(1, "Enter your email.")
  .email("Enter a valid email address.")
  .max(200);

const password = z
  .string()
  .min(GUEST_PASSWORD_MIN_LENGTH, `Password must be at least ${GUEST_PASSWORD_MIN_LENGTH} characters.`)
  .max(200);

export const signUpEmailSchema = z.object({
  fullName: z.string().trim().min(1, "Enter your name.").max(120),
  email,
  password,
  mobile,
});
export type SignUpEmailInput = z.input<typeof signUpEmailSchema>;

export const logInEmailSchema = z.object({
  email,
  password: z.string().min(1, "Enter your password.").max(200),
});
export type LogInEmailInput = z.input<typeof logInEmailSchema>;

export const requestPhoneOtpSchema = z.object({
  mobile,
  /** Captured on the phone-signup path so a brand-new account has a name. */
  fullName: z.string().trim().max(120).optional(),
});
export type RequestPhoneOtpInput = z.input<typeof requestPhoneOtpSchema>;

export const verifyPhoneOtpSchema = z.object({
  mobile,
  code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code."),
  fullName: z.string().trim().max(120).optional(),
});
export type VerifyPhoneOtpInput = z.input<typeof verifyPhoneOtpSchema>;

/** A signed-in guest's booking submission. Identity comes from the session, so no
 *  contact fields here — only what to book, and how to pay. */
export const guestBookingSchema = z.object({
  slug: z.string().min(1),
  roomCategoryId: z.string().min(1),
  checkInDate: z.coerce.date(),
  checkOutDate: z.coerce.date(),
  adults: z.number().int().min(1).max(20),
  children: z.number().int().min(0).max(20).default(0),
  rooms: z.number().int().min(1).max(10).default(1),
  couponCode: z.string().trim().min(2).max(40).optional(),
  paymentPreference: z.enum(["PAY_NOW", "PARTIAL", "PAY_AT_HOTEL"]),
  consentAccepted: z.literal(true, {
    errorMap: () => ({ message: "Please accept the terms to book." }),
  }),
});
export type GuestBookingInput = z.input<typeof guestBookingSchema>;

/** Guest self-service online check-in (Wave 2). */
export const onlineCheckInSchema = z.object({
  reservationId: z.string().min(1),
  signatureBase64: z.string().min(1, "Please sign to complete check-in."),
  expectedArrival: z.string().trim().max(40).optional(),
  specialRequests: z.string().trim().max(500).optional(),
});
export type OnlineCheckInInput = z.input<typeof onlineCheckInSchema>;

/** A guest's request for a catalog add-on against their own booking (Wave 3). */
export const requestAddOnSchema = z.object({
  reservationId: z.string().min(1),
  addOnId: z.string().min(1),
  quantity: z.number().int().min(1).max(10).default(1),
  note: z.string().trim().max(300).optional(),
});
export type RequestAddOnInput = z.input<typeof requestAddOnSchema>;

/** A chat message from a checked-in guest to reception (Phase 6). */
export const sendGuestMessageSchema = z.object({
  body: z.string().trim().min(1, "Type a message.").max(1000),
});
export type SendGuestMessageInput = z.input<typeof sendGuestMessageSchema>;

/** An in-room service request from a checked-in guest (Phase 4). */
export const guestRequestSchema = z.object({
  kind: z.enum(["HOUSEKEEPING", "MAINTENANCE", "AMENITY", "OTHER"]),
  detail: z.string().trim().min(3, "Tell us a little more.").max(500),
});
export type GuestRequestInput = z.input<typeof guestRequestSchema>;
