/**
 * Structured logging with the request id attached
 * (non-functional-requirements.md § Observability).
 *
 * Hard rule from security.md: no secret and no PII ever reaches a log. Values
 * are passed through `redact()` which drops known-sensitive keys rather than
 * relying on every call site to remember.
 */
import { getContext } from "./context";

type Level = "debug" | "info" | "warn" | "error";

/**
 * Keys whose values are never logged. Matched case-insensitively as substrings
 * so `guestMobile`, `mobileHash`, and `mobile` are all caught.
 */
const SENSITIVE_KEY_PATTERNS = [
  "password",
  "passwordhash",
  "secret",
  "token",
  "authorization",
  "cookie",
  "apikey",
  "api_key",
  "aadhaar",
  "passport",
  "totp",
  "backupcode",
  "mobile",
  "whatsapp",
  "email",
  "phone",
  "address",
  "dob",
  "pan",
  "bankaccount",
  "ifsc",
  "gstin",
  "medical",
] as const;

const REDACTED = "[redacted]";

function isSensitiveKey(key: string): boolean {
  const k = key.toLowerCase();
  return SENSITIVE_KEY_PATTERNS.some((p) => k.includes(p));
}

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[depth-limit]";
  if (value === null || value === undefined) return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = isSensitiveKey(k) ? REDACTED : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

function emit(level: Level, message: string, meta?: Record<string, unknown>): void {
  const ctx = getContext();
  const line = {
    level,
    message,
    time: new Date().toISOString(),
    requestId: ctx?.requestId,
    userId: ctx?.userId,
    orgId: ctx?.orgId,
    ...(meta ? { meta: redact(meta) } : {}),
  };
  const serialized = JSON.stringify(line);
  if (level === "error") console.error(serialized);
  else if (level === "warn") console.warn(serialized);
  else console.log(serialized);
}

export const logger = {
  debug: (m: string, meta?: Record<string, unknown>) => {
    if (process.env.NODE_ENV !== "production") emit("debug", m, meta);
  },
  info: (m: string, meta?: Record<string, unknown>) => emit("info", m, meta),
  warn: (m: string, meta?: Record<string, unknown>) => emit("warn", m, meta),
  error: (m: string, meta?: Record<string, unknown>) => emit("error", m, meta),
};
