/**
 * Guest PII masking dispatcher — 04 T-5 (FR-4/FR-8, AC-5/AC-7).
 *
 * The actual masking rules live in `lib/crypto/encryption.ts` (one home for all
 * masking, used by logs and exports too). This is a thin per-field dispatcher
 * so guest code can say `maskContact(value, "mobile")` without knowing which
 * helper applies — and so the ID-type → mask-style mapping lives in one place.
 */
import type { IdType } from "@prisma/client";
import {
  maskAadhaar,
  maskEmail,
  maskMobile,
  maskTail,
} from "@/lib/crypto/encryption";

export type ContactKind = "mobile" | "whatsapp" | "email";

/** Mask a contact field for a list/search/export row (FR-8). */
export function maskContact(
  value: string | null | undefined,
  kind: ContactKind,
): string | null {
  if (!value) return null;
  switch (kind) {
    case "mobile":
    case "whatsapp":
      return maskMobile(value);
    case "email":
      return maskEmail(value);
  }
}

/**
 * Mask a government-ID value by its type.
 *
 * Aadhaar uses the UIDAI last-4 form (`XXXX XXXX 9012`, AC-5); everything else
 * shows the last 4 characters, which is enough for a receptionist to confirm
 * the right document without exposing the number.
 */
export function maskIdValue(type: IdType, value: string | null | undefined): string | null {
  if (!value) return null;
  return type === "AADHAAR" ? maskAadhaar(value) : maskTail(value, 4);
}

/** Aadhaar last-4, the only form stored while full storage is off (FR-4). */
export function aadhaarMasked(value: string): string {
  return maskAadhaar(value) ?? "XXXX XXXX XXXX";
}
