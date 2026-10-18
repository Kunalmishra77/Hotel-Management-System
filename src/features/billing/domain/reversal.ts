/**
 * The "active line" rules of an append-only folio — 06 (FR-7, business-rules §7).
 *
 * A folio is never edited: a correction appends a REVERSAL line that references
 * the original (`reversalOfId`). So EVERY consumer has to answer the same
 * question before it can add anything up — *which lines still count?* — and the
 * answers used to be ad-hoc:
 *
 *   • `folioBalance` summed the signed amounts, which nets correctly ONLY
 *     because a reversal carries the exact negation. Fine for one total.
 *   • The night audit summed `type = 'ROOM'` per business date — a REVERSAL has
 *     `type = 'REVERSAL'`, so it cancelled NOTHING: once a room-night had been
 *     reversed (early check-out, rate correction, transfer) room revenue, ADR
 *     and RevPAR stayed permanently inflated for that day.
 *   • The "which nights are already billed" guards keyed on `businessDate`
 *     alone, counting reversed nights as billed — so a night that had been
 *     reversed could never be re-billed, and an extend silently skipped it.
 *
 * This module defines those rules ONCE, pure and DB-free, so no screen, report
 * or posting path re-derives them differently.
 *
 * The rule: a line counts unless a REVERSAL points at it, and a REVERSAL that
 * points at something never counts itself (its target is dropped instead — the
 * pair nets to nothing on the ORIGINAL night, not on the day of the reversal).
 * A REVERSAL with no target is an unlinked manual adjustment and DOES count, so
 * money is never silently lost.
 */

export type LedgerLine = {
  id: string;
  /** `ChargeType` as a string — this module is deliberately enum-agnostic. */
  type: string;
  amountPaise: bigint | number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  businessDate: Date;
  revision?: number | null;
  reversalOfId?: string | null;
};

/** `YYYY-MM-DD` of a `@db.Date` value (stored at UTC midnight). */
export function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Ids of lines voided by a linked REVERSAL. */
export function reversedLineIds(lines: readonly LedgerLine[]): Set<string> {
  const out = new Set<string>();
  for (const l of lines) {
    if (l.reversalOfId) out.add(l.reversalOfId);
  }
  return out;
}

/**
 * The lines that still count. Drops both halves of every reversal pair; keeps an
 * unlinked REVERSAL (a manual adjustment that stands on its own).
 */
export function activeLines<T extends LedgerLine>(lines: readonly T[]): T[] {
  const reversed = reversedLineIds(lines);
  return lines.filter((l) => !reversed.has(l.id) && !(l.type === "REVERSAL" && l.reversalOfId));
}

/**
 * The nights that carry an ACTIVE ROOM charge, as `YYYY-MM-DD` keys — the
 * canonical "already billed" guard for check-in, the night audit, extend and
 * check-out. A reversed night is absent, so it is billable again.
 */
export function activeRoomNightKeys(lines: readonly LedgerLine[]): Set<string> {
  const out = new Set<string>();
  for (const l of activeLines(lines)) {
    if (l.type === "ROOM") out.add(dateKey(l.businessDate));
  }
  return out;
}

/**
 * The `revision` to use when posting `night` as a ROOM line: one past the
 * highest ever used for that night on this folio (reversed revisions included —
 * the partial unique index `(folioId, businessDate, revision) WHERE type='ROOM'`
 * still holds them). 0 for a night never posted.
 */
export function nextRoomRevision(lines: readonly LedgerLine[], night: string | Date): number {
  const key = typeof night === "string" ? night : dateKey(night);
  let max = -1;
  for (const l of lines) {
    if (l.type !== "ROOM" || dateKey(l.businessDate) !== key) continue;
    max = Math.max(max, l.revision ?? 0);
  }
  return max + 1;
}

/** Taxable (pre-GST) total of a line set. */
export function netTaxable(lines: readonly LedgerLine[]): bigint {
  let sum = 0n;
  for (const l of lines) sum += BigInt(l.amountPaise);
  return sum;
}

/** GST total of a line set. */
export function netTax(lines: readonly LedgerLine[]): bigint {
  let sum = 0n;
  for (const l of lines) sum += BigInt(l.cgstPaise) + BigInt(l.sgstPaise) + BigInt(l.igstPaise);
  return sum;
}

/**
 * Active taxable revenue per business date, optionally restricted to some charge
 * types — the per-day basis for room revenue, ADR, RevPAR and the daily revenue
 * trend. Reversals are resolved against the night they cancel, so a corrected
 * night reports its CORRECTED amount on its OWN date and a reversed night
 * reports nothing (rather than denting whichever day the reversal was keyed to).
 */
export function netAmountByDate(
  lines: readonly LedgerLine[],
  types?: readonly string[],
): Map<string, bigint> {
  const wanted = types ? new Set(types) : null;
  const out = new Map<string, bigint>();
  for (const l of activeLines(lines)) {
    if (wanted && !wanted.has(l.type)) continue;
    const key = dateKey(l.businessDate);
    out.set(key, (out.get(key) ?? 0n) + BigInt(l.amountPaise));
  }
  return out;
}

