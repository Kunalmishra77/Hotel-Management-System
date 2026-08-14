/**
 * Contact normalisation & keyed hashing for guest accounts (Phase 2).
 *
 * These MUST match how `upsertPublicGuest` (booking-engine/internal.ts) hashes a
 * guest's contact, so a self-service account links to the SAME CRM `Guest`:
 *   mobileHash = keyedHash(normalizeMobile(mobile).toLowerCase())
 *   emailHash  = keyedHash(email.trim().toLowerCase())
 * The raw values are encrypted at rest with `encryptString`; only the keyed hash
 * is queryable (compliance.md — no plaintext PII in an index).
 */
import { keyedHash } from "@/lib/crypto/encryption";

/** Strip spaces/dashes only — identical to the booking-engine normaliser. */
export function normalizeMobile(mobile: string): string {
  return mobile.replace(/[\s-]/g, "").trim();
}

export function mobileHashOf(mobile: string): string {
  return keyedHash(normalizeMobile(mobile).toLowerCase());
}

export function emailHashOf(email: string): string {
  return keyedHash(email.trim().toLowerCase());
}
