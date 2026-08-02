/**
 * Zod schemas for the auth feature — api-conventions.md ("every input boundary
 * validated"; zod schemas live in features/*​/schema.ts).
 */
import { z } from "zod";

export const signInSchema = z.object({
  email: z.string().trim().min(1, "Email is required.").email("Enter a valid email address."),
  password: z.string().min(1, "Password is required."),
  /** Where to return after a successful sign-in (middleware supplies it). */
  next: z.string().optional(),
});

export const totpSchema = z.object({
  challenge: z.string().min(1),
  /** 6 digits, or a 10-character backup code. */
  code: z
    .string()
    .trim()
    .min(6, "Enter the 6-digit code.")
    .max(14, "That code is too long."),
  next: z.string().optional(),
});

export const requestPasswordResetSchema = z.object({
  email: z.string().trim().min(1, "Email is required.").email("Enter a valid email address."),
});

export const resetPasswordSchema = z
  .object({
    token: z.string().min(1),
    password: z.string().min(1, "Choose a password."),
    confirmPassword: z.string().min(1, "Confirm your password."),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });

export const confirmTwoFactorSchema = z.object({
  code: z.string().trim().length(6, "Enter the 6-digit code from your authenticator app."),
});

export type SignInInput = z.infer<typeof signInSchema>;
export type TotpInput = z.infer<typeof totpSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
