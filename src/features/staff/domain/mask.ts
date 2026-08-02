/**
 * Staff ID masking — 09 T-5 (FR-7, AC-4). Reuses the platform masking helpers so
 * Aadhaar/PAN are stored and shown masked; the raw value is never persisted on
 * the Staff row (compliance.md).
 */
import { maskAadhaar, maskTail } from "@/lib/crypto/encryption";

export function maskId(kind: "AADHAAR" | "PAN", value: string | null | undefined): string | null {
  if (!value) return null;
  return kind === "AADHAAR" ? maskAadhaar(value) : maskTail(value, 4);
}
