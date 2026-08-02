# 05 · Guest History — Tasks

Test-first for derivation. History is derived; snapshot is a cache. Each ends at `rules/definition-of-done.md`. `(AC-n)/(FR-n)`.

## Schema & migration
- [x] T-1 Materialize `GuestStatsSnapshot` — `preferredCategoryId`/`preferredRatePaise`/`lastReconciledAt` and **BigInt** `totalRevenuePaise`/`outstandingPaise` are **confirmed present in canonical schema**; migration only materializes the model.
- [x] T-2 Seed fixtures (G-RAVI 3 stays, G-NEW).

## Domain (tests first)
- [x] T-3 `deriveStats(reservations, guestBilling)` over 03 reservations + **06 `guestBilling` roll-up** (single call, no per-reservation fan-out); revenue net-of-discount tax-excluded. (FR-1/6, AC-1/2/7)
- [x] T-4 `preferredCategory/preferredRate`. (FR-1, AC-1)

## Application (integration tests)
- [x] T-5 Event consumers update snapshot idempotently across the **full folio-mutating set** (`FolioCharged`, `PaymentReceived`, `PaymentRefunded`, `DiscountApplied`, `InvoiceIssued`/void) + `GuestCheckedOut`/`FeedbackReceived`; re-delivered event → no double count. (FR-2, AC-3)
- [x] T-5b `GuestMerged` consumer recomputes **both** survivor and loser snapshots. (FR-2b, AC-8)
- [x] T-6 `reconcileGuestStats` recomputes from source on drift. (FR-5, AC-4)
- [x] T-7 `getGuestHistory` stats + payments + feedback + bills; permissioned + masked. (FR-3/4, AC-5/6)
- [x] T-8 Consistency with 14 revenue (paisa). (FR-6, AC-7)

## UI (mobile-first)
- [x] T-9 History tab in 04 profile (permission-gated financials, bill links). (AC-5/6)

## E2E
- [x] T-10 Journey: guest with stays → history shows derived metrics → new stay updates snapshot. (AC-1/3/5)

## Done
- [x] T-11 `/review-module` clean; reconciles with 06/14; every AC → green test; DoD satisfied.
