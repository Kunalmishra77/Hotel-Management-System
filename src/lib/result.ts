/**
 * The typed Result every server action returns (api-conventions.md).
 * Actions never throw raw to the client: a thrown DomainError is converted here
 * into `{ ok: false, error }` carrying only a code, a user-safe message, and a
 * requestId the user can quote to support.
 */
import { ZodError } from "zod";
import { ErrorCode, isDomainError, messageForCode, userMessageFor } from "./errors";
import { getRequestId } from "./context";
import { logger } from "./logger";

export type ActionError = {
  code: ErrorCode;
  message: string;
  requestId?: string;
  /** Field-level messages for form rendering; never contains server internals. */
  fieldErrors?: Record<string, string[]>;
};

export type Result<T> = { ok: true; data: T } | { ok: false; error: ActionError };

export function ok<T>(data: T): Result<T> {
  return { ok: true, data };
}

export function fail<T = never>(
  code: ErrorCode,
  message: string,
  fieldErrors?: Record<string, string[]>,
): Result<T> {
  return { ok: false, error: { code, message, requestId: getRequestId(), fieldErrors } };
}

/**
 * Wrap an action body so any thrown DomainError becomes a typed failure and any
 * unexpected error is logged server-side but surfaced only as INTERNAL.
 */
export async function toResult<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return ok(await fn());
  } catch (e) {
    if (isDomainError(e)) {
      logger.warn("action.rejected", { code: e.code, details: e.details });
      return { ok: false, error: { code: e.code, message: e.userMessage, requestId: getRequestId() } };
    }
    // Invalid input: a boundary `zod.parse` throws ZodError. Surface it as a
    // typed 400 with per-field messages (api-conventions.md) — never an opaque
    // INTERNAL. Field keys only; no values, so nothing PII lands in the payload.
    if (e instanceof ZodError) {
      const fieldErrors: Record<string, string[]> = {};
      for (const issue of e.issues) {
        const key = issue.path.join(".") || "_";
        (fieldErrors[key] ??= []).push(issue.message);
      }
      return fail(ErrorCode.VALIDATION_FAILED, messageForCode(ErrorCode.VALIDATION_FAILED), fieldErrors);
    }
    // Unexpected: the detail stays in the log, the caller gets an opaque id.
    logger.error("action.failed", { error: e instanceof Error ? e.message : String(e) });
    return {
      ok: false,
      error: { code: ErrorCode.INTERNAL, message: userMessageFor(e), requestId: getRequestId() },
    };
  }
}
