/**
 * Guest-auth infrastructure barrel (Phase 2). Isolated from staff auth: separate
 * cookie, separate DB-backed session, no role/permission, no property scope.
 */
export {
  GUEST_SESSION_COOKIE,
  GUEST_SESSION_TTL_DAYS,
  createGuestSession,
  resolveGuestSession,
  revokeGuestSession,
  type GuestPrincipal,
} from "./session";
export { normalizeMobile, mobileHashOf, emailHashOf } from "./contact";
export {
  OTP_CODE_LENGTH,
  OTP_TTL_MINUTES,
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_COOLDOWN_SECONDS,
  generateOtpCode,
  hashOtpCode,
  isWellFormedOtpCode,
  otpExpiryFrom,
  canResendOtp,
  checkOtp,
  type OtpRecord,
  type OtpCheck,
} from "./otp";
export {
  GUEST_MAX_FAILED_LOGINS,
  GUEST_LOCK_MINUTES,
  isLocked,
  nextLockState,
} from "./lockout";

/** Convenience: the current signed-in guest principal, or null. */
export { resolveGuestSession as getCurrentGuest } from "./session";
