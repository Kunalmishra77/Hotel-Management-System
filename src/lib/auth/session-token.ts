/**
 * Session token generation + hashing — 00 FR-2, security.md § Authentication.
 *
 * The raw token lives only in the client's cookie. The DB stores
 * `sha256(token)` in `Session.tokenHash`, so a database dump yields no usable
 * sessions. Plain SHA-256 (not bcrypt) is correct here for the same reason as
 * backup codes: the token is 256 CSPRNG bits of our own making, so there is
 * nothing to brute-force and a slow KDF would tax every single request.
 */
import { createHash, randomBytes } from "node:crypto";

/** 256 bits. */
export const SESSION_TOKEN_BYTES = 32;

/** base64url of 32 bytes = 43 chars, no padding. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function generateSessionToken(): string {
  return randomBytes(SESSION_TOKEN_BYTES).toString("base64url");
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Shape check before touching the database — a garbage or oversized cookie
 * should be rejected without costing a query.
 */
export function isWellFormedSessionToken(token: string): boolean {
  return TOKEN_PATTERN.test(token);
}
