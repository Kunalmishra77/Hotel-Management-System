/**
 * Typed domain errors + the shared error-code enum.
 *
 * coding-standards.md: throw typed domain errors inward; map them to user-safe
 * messages at the action boundary. A stack trace or PII never reaches a client.
 * Error catalogue for 00-platform: specs/00-platform/design.md § Error catalog.
 */

export const ErrorCode = {
  // Auth (00)
  INVALID_CREDENTIALS: "INVALID_CREDENTIALS",
  TOTP_REQUIRED: "TOTP_REQUIRED",
  TOTP_INVALID: "TOTP_INVALID",
  ACCOUNT_LOCKED: "ACCOUNT_LOCKED",
  ACCOUNT_INACTIVE: "ACCOUNT_INACTIVE",
  TOKEN_INVALID: "TOKEN_INVALID",
  SESSION_EXPIRED: "SESSION_EXPIRED",
  TWO_FACTOR_ENROLMENT_REQUIRED: "TWO_FACTOR_ENROLMENT_REQUIRED",

  // Authorization / tenancy (00)
  FORBIDDEN: "FORBIDDEN",
  OUT_OF_SCOPE: "OUT_OF_SCOPE",
  UNAUTHENTICATED: "UNAUTHENTICATED",
  REASON_REQUIRED: "REASON_REQUIRED",

  // Reservations (03)
  ROOM_UNAVAILABLE: "ROOM_UNAVAILABLE",
  ILLEGAL_TRANSITION: "ILLEGAL_TRANSITION",
  OCCUPANCY_EXCEEDED: "OCCUPANCY_EXCEEDED",
  RATE_BELOW_FLOOR: "RATE_BELOW_FLOOR",
  BALANCE_UNSETTLED: "BALANCE_UNSETTLED",

  // Billing (06)
  INVALID_AMOUNT: "INVALID_AMOUNT",
  SPLIT_MISMATCH: "SPLIT_MISMATCH",
  REFUND_EXCEEDS_PAID: "REFUND_EXCEEDS_PAID",
  DISCOUNT_OVER_THRESHOLD: "DISCOUNT_OVER_THRESHOLD",
  CLOSED_DATE_POSTING: "CLOSED_DATE_POSTING",
  CREDIT_LIMIT_EXCEEDED: "CREDIT_LIMIT_EXCEEDED",
  SERIES_LOCK_TIMEOUT: "SERIES_LOCK_TIMEOUT",
  WEBHOOK_SIGNATURE_INVALID: "WEBHOOK_SIGNATURE_INVALID",
  COUPON_INVALID: "COUPON_INVALID",
  COUPON_EXHAUSTED: "COUPON_EXHAUSTED",
  COUPON_INELIGIBLE: "COUPON_INELIGIBLE",

  // Maintenance (11)
  ROOM_HAS_RESERVATION: "ROOM_HAS_RESERVATION",

  // Search & Export (15)
  INVALID_QUERY: "INVALID_QUERY",
  EXPORT_TOO_LARGE_ASYNC: "EXPORT_TOO_LARGE_ASYNC",

  // Communications (12)
  RENDER_MISSING_VAR: "RENDER_MISSING_VAR",
  TEMPLATE_NOT_APPROVED: "TEMPLATE_NOT_APPROVED",
  MARKETING_SUPPRESSED: "MARKETING_SUPPRESSED",

  // AI (18)
  AI_PROVIDER_ERROR: "AI_PROVIDER_ERROR",

  // Booking engine (23)
  STAY_CONSTRAINT_VIOLATION: "STAY_CONSTRAINT_VIOLATION",
  BOT_REJECTED: "BOT_REJECTED",
  HOLD_EXPIRED: "HOLD_EXPIRED",
  CONSENT_REQUIRED: "CONSENT_REQUIRED",

  // OTA / channel (13)
  CHANNEL_NOT_CERTIFIED: "CHANNEL_NOT_CERTIFIED",
  MAPPING_MISSING: "MAPPING_MISSING",

  // Dynamic pricing (24)
  RATE_OUT_OF_BOUNDS: "RATE_OUT_OF_BOUNDS",

  // POS (19)
  FOLIO_TARGET_INVALID: "FOLIO_TARGET_INVALID",
  ORDER_NOT_OPEN: "ORDER_NOT_OPEN",

  // Inventory (20)
  NEGATIVE_STOCK: "NEGATIVE_STOCK",

  // Payroll (21)
  RUN_LOCKED: "RUN_LOCKED",

  // Data onboarding / import (26)
  GUEST_UNMATCHED: "GUEST_UNMATCHED",
  UNKNOWN_MASTER_DATA: "UNKNOWN_MASTER_DATA",

  // Housekeeping (10)
  SYNC_CONFLICT: "SYNC_CONFLICT",

  // Staff (09)
  ATTENDANCE_DUPLICATE: "ATTENDANCE_DUPLICATE",

  // Generic
  VALIDATION_FAILED: "VALIDATION_FAILED",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  RATE_LIMITED: "RATE_LIMITED",
  INTERNAL: "INTERNAL",
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/** HTTP status for each code — used by route handlers (api-conventions.md). */
const HTTP_STATUS: Record<ErrorCode, number> = {
  INVALID_CREDENTIALS: 401,
  TOTP_REQUIRED: 401,
  TOTP_INVALID: 401,
  ACCOUNT_LOCKED: 423,
  ACCOUNT_INACTIVE: 403,
  TOKEN_INVALID: 400,
  SESSION_EXPIRED: 401,
  TWO_FACTOR_ENROLMENT_REQUIRED: 403,
  FORBIDDEN: 403,
  OUT_OF_SCOPE: 403,
  UNAUTHENTICATED: 401,
  REASON_REQUIRED: 400,
  ROOM_UNAVAILABLE: 409,
  ILLEGAL_TRANSITION: 409,
  OCCUPANCY_EXCEEDED: 422,
  RATE_BELOW_FLOOR: 422,
  BALANCE_UNSETTLED: 409,
  INVALID_AMOUNT: 422,
  SPLIT_MISMATCH: 422,
  REFUND_EXCEEDS_PAID: 422,
  DISCOUNT_OVER_THRESHOLD: 403,
  CLOSED_DATE_POSTING: 409,
  CREDIT_LIMIT_EXCEEDED: 409,
  SERIES_LOCK_TIMEOUT: 409,
  WEBHOOK_SIGNATURE_INVALID: 401,
  COUPON_INVALID: 422,
  COUPON_EXHAUSTED: 409,
  COUPON_INELIGIBLE: 422,
  ATTENDANCE_DUPLICATE: 409,
  INVALID_QUERY: 400,
  EXPORT_TOO_LARGE_ASYNC: 202,
  RENDER_MISSING_VAR: 422,
  TEMPLATE_NOT_APPROVED: 409,
  MARKETING_SUPPRESSED: 409,
  AI_PROVIDER_ERROR: 502,
  STAY_CONSTRAINT_VIOLATION: 422,
  BOT_REJECTED: 403,
  HOLD_EXPIRED: 409,
  CONSENT_REQUIRED: 400,
  CHANNEL_NOT_CERTIFIED: 403,
  MAPPING_MISSING: 422,
  RATE_OUT_OF_BOUNDS: 422,
  FOLIO_TARGET_INVALID: 422,
  ORDER_NOT_OPEN: 409,
  NEGATIVE_STOCK: 422,
  RUN_LOCKED: 409,
  GUEST_UNMATCHED: 422,
  UNKNOWN_MASTER_DATA: 422,
  SYNC_CONFLICT: 409,
  ROOM_HAS_RESERVATION: 409,
  VALIDATION_FAILED: 400,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};

/**
 * User-safe messages. Deliberately generic for the auth codes: FR-4 forbids
 * account enumeration, so INVALID_CREDENTIALS, a non-existent email, and a
 * locked account must be indistinguishable to the caller.
 */
const USER_MESSAGE: Record<ErrorCode, string> = {
  INVALID_CREDENTIALS: "Incorrect email or password.",
  TOTP_REQUIRED: "Enter your two-factor code to continue.",
  TOTP_INVALID: "That code isn't valid. Try again.",
  // Same wording as INVALID_CREDENTIALS on purpose — see FR-4 (no enumeration).
  ACCOUNT_LOCKED: "Incorrect email or password.",
  ACCOUNT_INACTIVE: "This account is not active. Contact your administrator.",
  TOKEN_INVALID: "This link is invalid or has expired.",
  SESSION_EXPIRED: "Your session has expired. Please sign in again.",
  TWO_FACTOR_ENROLMENT_REQUIRED: "Your role requires two-factor authentication. Set it up to continue.",
  FORBIDDEN: "You don't have permission to do that.",
  OUT_OF_SCOPE: "You don't have access to that property.",
  UNAUTHENTICATED: "Please sign in to continue.",
  REASON_REQUIRED: "A reason is required for this action.",
  ROOM_UNAVAILABLE: "That room isn't available for those dates.",
  ILLEGAL_TRANSITION: "That change isn't allowed from the booking's current status.",
  OCCUPANCY_EXCEEDED: "That's more guests than the room allows. Add an extra bed or choose a larger category.",
  RATE_BELOW_FLOOR: "That rate or discount needs a manager's approval.",
  BALANCE_UNSETTLED: "There's an unsettled balance. Settle it or defer with permission before checking out.",
  INVALID_AMOUNT: "Enter an amount greater than zero.",
  SPLIT_MISMATCH: "The payment parts don't add up to the amount due.",
  REFUND_EXCEEDS_PAID: "That refund is more than what's been paid.",
  DISCOUNT_OVER_THRESHOLD: "That discount needs a manager's approval.",
  CLOSED_DATE_POSTING: "That business date is closed. Post the adjustment to the current day.",
  CREDIT_LIMIT_EXCEEDED: "That would exceed the corporate credit limit.",
  SERIES_LOCK_TIMEOUT: "The invoice counter is busy. Please try again.",
  WEBHOOK_SIGNATURE_INVALID: "The payment notification could not be verified.",
  COUPON_INVALID: "That coupon code isn't valid.",
  COUPON_EXHAUSTED: "That coupon has already been fully used.",
  COUPON_INELIGIBLE: "That coupon can't be applied to this booking.",
  ATTENDANCE_DUPLICATE: "Attendance for this day is already recorded.",
  INVALID_QUERY: "That search couldn't be run. Check the fields and try again.",
  EXPORT_TOO_LARGE_ASYNC: "This export is large — we'll prepare it and give you a download link.",
  RENDER_MISSING_VAR: "This message template is missing some information. Please review it.",
  TEMPLATE_NOT_APPROVED: "That message template isn't approved for sending yet.",
  MARKETING_SUPPRESSED: "This guest has opted out of marketing messages.",
  AI_PROVIDER_ERROR: "The AI service is unavailable right now. Please try again.",
  STAY_CONSTRAINT_VIOLATION: "Those dates don't meet the booking rules for this room. Please adjust your stay.",
  BOT_REJECTED: "We couldn't verify this request. Please try again.",
  HOLD_EXPIRED: "Your reservation hold has expired. Please search again.",
  CONSENT_REQUIRED: "Please accept the terms to complete your booking.",
  CHANNEL_NOT_CERTIFIED: "This channel isn't certified for live sync yet.",
  MAPPING_MISSING: "This booking's room type isn't mapped yet. It's been flagged for review.",
  RATE_OUT_OF_BOUNDS: "That rate is outside the approved floor/ceiling for this category.",
  FOLIO_TARGET_INVALID: "That booking can't take this charge. Settle the order directly instead.",
  ORDER_NOT_OPEN: "This order has already been settled or voided.",
  NEGATIVE_STOCK: "That movement would take stock below zero.",
  RUN_LOCKED: "This payroll run is finalized and can't be edited. Create an adjustment run.",
  GUEST_UNMATCHED: "This booking couldn't be matched to an existing guest. Import the guest first.",
  UNKNOWN_MASTER_DATA: "This row references a property or category that doesn't exist. Create it first.",
  ROOM_HAS_RESERVATION: "That room has a confirmed booking for those dates. Reallocate the guest first.",
  SYNC_CONFLICT: "This update is out of date — the room changed since. Please re-check.",
  VALIDATION_FAILED: "Please check the highlighted fields and try again.",
  NOT_FOUND: "We couldn't find what you were looking for.",
  CONFLICT: "That change conflicts with the current state. Refresh and retry.",
  RATE_LIMITED: "Too many attempts. Please wait and try again.",
  INTERNAL: "Something went wrong. Please try again.",
};

export type DomainErrorOptions = {
  /** Server-side log context. Never serialized to a client. */
  details?: Record<string, unknown>;
  /**
   * A specific, user-safe message that REPLACES the generic one.
   *
   * Opt-in by design. The generic messages exist so a failure cannot be used as
   * an oracle — FR-4's anti-enumeration rule depends on every auth rejection
   * reading identically — so specificity must be a deliberate act, never the
   * default. Set it only when the text describes a business-rule collision the
   * user needs in order to fix their input ("Code WMG is already in use"), and
   * never when it would reveal what exists, who exists, or why access failed.
   */
  publicMessage?: string;
};

export class DomainError extends Error {
  readonly code: ErrorCode;
  readonly details?: Record<string, unknown>;
  private readonly publicMessage?: string;

  constructor(
    code: ErrorCode,
    message?: string,
    detailsOrOptions?: Record<string, unknown> | DomainErrorOptions,
  ) {
    super(message ?? code);
    this.name = new.target.name;
    this.code = code;

    // Accept the historical `details` object as well as the options form.
    if (detailsOrOptions && "publicMessage" in detailsOrOptions) {
      const options = detailsOrOptions as DomainErrorOptions;
      this.details = options.details;
      this.publicMessage = options.publicMessage;
    } else {
      this.details = detailsOrOptions as Record<string, unknown> | undefined;
    }
  }

  get httpStatus(): number {
    return HTTP_STATUS[this.code];
  }

  /** The only text that may cross the boundary to a client. */
  get userMessage(): string {
    return this.publicMessage ?? USER_MESSAGE[this.code];
  }
}

/** Caller lacks the permission, or the target property is outside their scope. */
export class ForbiddenError extends DomainError {
  constructor(message?: string, details?: Record<string, unknown>) {
    super(ErrorCode.FORBIDDEN, message, details);
  }
}

/** FR-9: the request targets a property the caller cannot access. */
export class OutOfScopeError extends DomainError {
  constructor(message?: string, details?: Record<string, unknown>) {
    super(ErrorCode.OUT_OF_SCOPE, message, details);
  }
}

export class UnauthenticatedError extends DomainError {
  constructor(message?: string) {
    super(ErrorCode.UNAUTHENTICATED, message);
  }
}

export class NotFoundError extends DomainError {
  constructor(message?: string, details?: Record<string, unknown>) {
    super(ErrorCode.NOT_FOUND, message, details);
  }
}

/**
 * A business-rule collision the caller can act on: a taken code, a duplicate
 * floor, guests still in-house.
 *
 * Its message IS shown to the user, unlike the other error types. That is safe
 * and necessary here: a conflict is about data the caller just submitted, so it
 * reveals nothing they did not already supply, and a generic "that conflicts"
 * gives them no way to fix it. Callers must therefore keep these messages
 * user-facing — never put internal detail in a ConflictError message.
 */
export class ConflictError extends DomainError {
  constructor(message?: string, details?: Record<string, unknown>) {
    super(ErrorCode.CONFLICT, message, { details, publicMessage: message });
  }
}

export function isDomainError(e: unknown): e is DomainError {
  return e instanceof DomainError;
}

export function httpStatusFor(e: unknown): number {
  return isDomainError(e) ? e.httpStatus : 500;
}

export function userMessageFor(e: unknown): string {
  return isDomainError(e) ? e.userMessage : USER_MESSAGE.INTERNAL;
}

/** The generic user-safe message for a code, for failures built without a DomainError. */
export function messageForCode(code: ErrorCode): string {
  return USER_MESSAGE[code];
}
