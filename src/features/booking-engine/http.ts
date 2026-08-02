/**
 * Shared response helpers for the public booking-engine route handlers.
 * Keeps error shaping (user-safe message + code + status, no PII, no stack) in
 * one place (api-conventions.md). Not a route file — lives in the feature dir.
 */
import { httpStatusFor, isDomainError, userMessageFor } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { checkRateLimit, clientIp, type RateLimitRoute } from "./internal";

export function jsonError(e: unknown): Response {
  if (isDomainError(e)) {
    return Response.json({ error: { code: e.code, message: e.userMessage } }, { status: httpStatusFor(e) });
  }
  logger.error("booking-engine.route_failed", { error: e instanceof Error ? e.message : String(e) });
  return Response.json({ error: { code: "INTERNAL", message: userMessageFor(e) } }, { status: 500 });
}

/**
 * Enforce the per-IP+route limit. Returns a 429 Response (with Retry-After and
 * NO side effects) when exceeded, or null to proceed (FR-10, AC-11).
 */
export function enforceRateLimit(route: RateLimitRoute, request: Request): Response | null {
  const result = checkRateLimit(route, clientIp(request.headers));
  if (result.ok) return null;
  return Response.json(
    { error: { code: "RATE_LIMITED", message: "Too many requests. Please wait and try again." } },
    { status: 429, headers: { "Retry-After": String(result.retryAfterSec) } },
  );
}
