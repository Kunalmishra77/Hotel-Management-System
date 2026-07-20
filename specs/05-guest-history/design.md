# 05 · Guest History — Design

## Schema slice (from canonical `prisma/schema.prisma`)
Owns `GuestStatsSnapshot` (cache keyed by `guestId`). Reads `Reservation`, the guest billing roll-up via `06.guestBilling`, `Feedback` via owning modules' query layers. **Schema notes — confirmed present in canonical schema:** `GuestStatsSnapshot.preferredCategoryId`, `preferredRatePaise`, `lastReconciledAt` (and **`BigInt`** `totalRevenuePaise`/`outstandingPaise`) — present; migration materializes the model, nothing here is "new".

## Domain layer (pure) — `features/guest-history/domain/`
- `deriveStats(reservations, guestBilling): GuestStats` — the single derivation over 03's reservations + **06's guest-scoped billing roll-up** (`guestBilling(guestId)` — one call, not a per-reservation fan-out), revenue net-of-discount tax-excluded (FR-1/6, aligned with `reporting.md`).
- `preferredCategory(reservations)` / `preferredRate(reservations)` — mode.

## Application — server actions / consumers (`features/guest-history`)
- Event consumers (00 dispatcher): on the **full folio-mutating set** — `FolioCharged`, `PaymentReceived`, `PaymentRefunded`, `DiscountApplied`, `InvoiceIssued` (incl. `CREDIT_NOTE`/void) — plus `GuestCheckedOut`, `FeedbackReceived`, and `GuestMerged` → recompute (via `guestBilling`) + upsert `GuestStatsSnapshot` idempotently (dedupe on event id). On `GuestMerged`, recompute **both** survivor and loser. (FR-2/2b)
- `reconcileGuestStats(guestId?)` job — recompute from source; fix drift. (FR-5)
- Queries `getGuestHistory(guestId)` (stats + payment/feedback/bills), permissioned + masked. (FR-3/4)

## UI — wireframes (mobile-first — the History tab in 04's profile)
```
┌───────────────────────────┐
│ Ravi Kumar · History      │
│ Visits 3 · Nights 8       │
│ Revenue ₹42,000 (fin.only)│
│ Outstanding ₹0            │
│ Prefers Deluxe            │
│ ── Bills ──               │
│ INV WMG/26-27/014  ₹13,410│
│ ── Feedback ── ★★★★☆      │
└───────────────────────────┘
```
Financial figures gated by permission; bills link to 06 invoice PDFs.

## Events
Emits: `GuestStatsUpdated`. Consumes the full folio-mutating set — `FolioCharged`, `PaymentReceived`, `PaymentRefunded`, `DiscountApplied`, `InvoiceIssued` (incl. `CREDIT_NOTE`/void) — plus `GuestCheckedOut`, `FeedbackReceived`, and `GuestMerged` (recompute survivor + loser). Catalog: `docs/architecture/domain-events.md`.

## Error catalog
`FORBIDDEN`.

## Edge cases
- New guest → zero stats, no errors.
- Re-delivered event (any of the folio-mutating set) → idempotent snapshot update, deduped on event id (FR-2).
- A `PaymentRefunded` or a `CREDIT_NOTE` (invoice void) → recompute reduces revenue/adjusts outstanding via `guestBilling`, so history matches 06/14 to the paisa.
- Snapshot drift → reconciliation recomputes from source (FR-5).
- Merged guest (04) → on `GuestMerged`, **both** snapshots recomputed: survivor inherits the combined history, the loser's snapshot is zeroed/merged-away (FR-2b).
