/**
 * `importKeyFor` — 26 T-6 (FR-6, AC-11). Pure domain.
 *
 * The natural idempotency key for a row: the identifier that means "this is the
 * same record" across re-imports. Re-uploading the same file must create zero
 * duplicates, so two rows describing the same real-world entity MUST produce the
 * same key regardless of spelling/spacing — hence it is built from ALREADY
 * NORMALISED values (normalize.ts), never the raw cell text.
 *
 * The key is stored on `ImportRow.importKey` (indexed) and is what within-file
 * and cross-batch dedup compare on. It is not a secret; it is a stable handle.
 */
import type { NormalizedRow } from "./validate";

/**
 * Build the idempotency key for a normalised row of a given kind. Returns null
 * when the row lacks the identifying field (an ERROR row that will never commit).
 *
 *  - GUESTS / BALANCES  → the guest's normalised mobile (the CRM identity, §16).
 *  - RESERVATIONS       → the external booking id if present, else
 *                         `mobile|checkIn|checkOut` (a guest can't occupy two
 *                         rooms on the same nights under one booking record).
 *  - ROOMS / STAFF      → the master-data code/name.
 */
export function importKeyFor(kind: string, n: NormalizedRow): string | null {
  switch (kind) {
    case "GUESTS":
    case "BALANCES":
      return n.mobile ? `${kind}:${n.mobile}` : null;
    case "RESERVATIONS": {
      if (n.externalRef) return `RESERVATIONS:ref:${n.externalRef}`;
      if (n.mobile && n.checkInDate && n.checkOutDate) {
        return `RESERVATIONS:${n.mobile}:${iso(n.checkInDate)}:${iso(n.checkOutDate)}`;
      }
      return null;
    }
    case "ROOMS":
      return n.roomNo ? `ROOMS:${n.roomNo.toLowerCase()}` : null;
    case "STAFF":
      return n.mobile ? `STAFF:${n.mobile}` : n.fullName ? `STAFF:${n.fullName.toLowerCase()}` : null;
    default:
      return null;
  }
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}
