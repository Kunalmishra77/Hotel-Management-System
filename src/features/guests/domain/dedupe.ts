/**
 * Duplicate detection + merge rule — 04 T-6/T-7 (FR-5/FR-12, AC-3/AC-11). Pure domain.
 *
 * business-rules.md §16: detect duplicates on phone/email/ID BEFORE creating a
 * guest. The score decides whether a second "Ravi" prompts merge/create-anyway
 * or silently makes a duplicate. The merge rule decides whose data survives —
 * get it wrong and a guest loses their stay history.
 *
 * All comparisons are on NORMALISED values (normalize.ts), so "+91 98765 43210"
 * and "9876543210" match. Callers must normalise before scoring.
 */
import { normalizeEmail, normalizePhone } from "./normalize";

export type GuestMatchInput = {
  fullName: string;
  mobile: string | null;
  email: string | null;
  /** Government-ID values as `TYPE:value` strings, already normalised. */
  idValues: readonly string[];
};

/**
 * Weights. A shared mobile/email/ID is a STRONG signal on its own — these are
 * the identifiers people don't share. Name is a WEAK signal: "Ravi Kumar" is
 * one of the most common names in India, so name-only must never clear the
 * probable-duplicate bar (AC-3), or staff learn to click through the prompt.
 */
const WEIGHT = {
  mobile: 0.8,
  email: 0.8,
  id: 0.85,
  name: 0.2,
} as const;

/** At or above this, prompt the user to merge/create-anyway (FR-5). */
export const DUPLICATE_THRESHOLD = 0.8;

export function isProbableDuplicate(score: number): boolean {
  return score >= DUPLICATE_THRESHOLD;
}

/**
 * How likely two records are the same guest, in [0, 1].
 *
 * The strongest single matching signal dominates rather than summing — two weak
 * coincidences (same common name + same city) should not add up to a false
 * "duplicate", but one shared mobile should be decisive on its own.
 */
export function duplicateScore(a: GuestMatchInput, b: GuestMatchInput): number {
  const signals: number[] = [];

  const aMobile = normalizePhone(a.mobile);
  const bMobile = normalizePhone(b.mobile);
  if (aMobile && bMobile && aMobile === bMobile) signals.push(WEIGHT.mobile);

  const aEmail = normalizeEmail(a.email);
  const bEmail = normalizeEmail(b.email);
  if (aEmail && bEmail && aEmail === bEmail) signals.push(WEIGHT.email);

  if (sharesAnyId(a.idValues, b.idValues)) signals.push(WEIGHT.id);

  if (namesSimilar(a.fullName, b.fullName)) signals.push(WEIGHT.name);

  if (signals.length === 0) return 0;

  // The dominant signal, nudged up slightly when several agree — but a single
  // strong match already clears the threshold, and weak signals alone cannot.
  const strongest = Math.max(...signals);
  const corroboration = (signals.length - 1) * 0.05;
  return Math.min(1, strongest + corroboration);
}

function sharesAnyId(a: readonly string[], b: readonly string[]): boolean {
  if (a.length === 0 || b.length === 0) return false;
  const set = new Set(a.map((v) => v.trim().toUpperCase()));
  return b.some((v) => set.has(v.trim().toUpperCase()));
}

/** Loose name match — normalised, case-insensitive, and prefix-tolerant. */
function namesSimilar(a: string, b: string): boolean {
  const na = a.trim().toLowerCase().replace(/\s+/g, " ");
  const nb = b.trim().toLowerCase().replace(/\s+/g, " ");
  if (na === "" || nb === "") return false;
  // "Ravi Kumar" vs "Ravi K" — one being a prefix of the other counts.
  return na === nb || na.startsWith(nb) || nb.startsWith(na);
}

// ---------------------------------------------------------------------------
// Merge (FR-12 / AC-11)
// ---------------------------------------------------------------------------

/**
 * The mergeable profile fields. Deliberately a subset — identity keys, hashes
 * and audit columns are handled by the action, not the field rule.
 */
export type MergeableFields = {
  fullName: string | null;
  email: string | null;
  whatsapp: string | null;
  city: string | null;
  foodPreference: string | null;
  specialRequests: string | null;
};

/**
 * Deterministic field combination (FR-12): the survivor's value wins wherever
 * it HAS one; the loser fills only the gaps. No data is silently discarded, and
 * the same inputs always produce the same output.
 *
 * A gap is null/undefined only. An explicit empty string on the survivor is a
 * deliberate clearing and is preserved — we do not resurrect it from the loser.
 * Pure: neither input is mutated.
 */
export function mergeFields<T extends Record<string, string | null | undefined>>(
  survivor: T,
  loser: T,
): T {
  const merged = { ...survivor };
  for (const key of Object.keys(survivor) as (keyof T)[]) {
    const survivorValue = survivor[key];
    if (survivorValue === null || survivorValue === undefined) {
      merged[key] = loser[key];
    }
  }
  return merged;
}
