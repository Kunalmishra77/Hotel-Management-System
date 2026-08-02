/**
 * Password hashing + policy — 00 FR-1.
 *
 * security.md mandates bcrypt with cost ≥ 12. The minimum length is NOT a
 * constant here: FR-1 sources it from `SecuritySettings.passwordMinLength`, so
 * callers pass it in.
 */
import bcrypt from "bcryptjs";

/** security.md: "passwords hashed with bcrypt (cost ≥ 12)". */
export const BCRYPT_COST = 12;

export async function hashPassword(plaintext: string): Promise<string> {
  return bcrypt.hash(plaintext, BCRYPT_COST);
}

/**
 * Compare a candidate against a stored hash.
 *
 * Returns false (never throws) when the stored value isn't a valid bcrypt hash
 * — a corrupted row must fail that sign-in, not crash the request. bcrypt's own
 * comparison is constant-time with respect to the digest.
 */
export async function verifyPassword(plaintext: string, storedHash: string): Promise<boolean> {
  if (!storedHash) return false;
  try {
    return await bcrypt.compare(plaintext, storedHash);
  } catch {
    return false;
  }
}

/**
 * Policy check. Returns the list of problems ([] = acceptable) so a form can
 * show all of them at once instead of one per submit.
 *
 * Deliberately length-only, per FR-1 and current NIST guidance: composition
 * rules ("must contain a symbol") push users toward predictable patterns
 * without adding real entropy. Length is the requirement that carries weight.
 */
export function passwordIssues(plaintext: string, minLength: number): string[] {
  const issues: string[] = [];
  if (plaintext.length < minLength) {
    issues.push(`Password must be at least ${minLength} characters.`);
  }
  return issues;
}

export function isPasswordAcceptable(plaintext: string, minLength: number): boolean {
  return passwordIssues(plaintext, minLength).length === 0;
}
