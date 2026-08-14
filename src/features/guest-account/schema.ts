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
