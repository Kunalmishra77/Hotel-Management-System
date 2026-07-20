# 05 · Guest History — User Stories & Acceptance Criteria

Roles per `rules/user-roles.md`. History is derived; snapshot is a cache.

## Test Fixtures
| Ref | Entity | Value |
|---|---|---|
| G-RAVI | Guest | 3 checked-out stays: 8 room-nights, revenue ₹42,000, ₹0 outstanding, mostly Deluxe |
| G-NEW | Guest | 0 stays |
| U-REC | User | RECEPTION (`guest:view`) |
| U-MGR | User | MANAGER (`report:view-financial`) |

## US-1 — Derived history
- **AC-1:** Given G-RAVI's 3 checked-out reservations (8 room-nights, ₹42,000 revenue net-of-discount tax-excluded), when the history is read, then visits=3, roomNights=8, totalRevenue=₹42,000, outstanding=₹0, preferredCategory=Deluxe, lastStay set. (FR-1/6)
- **AC-2:** Given G-NEW, when read, then all metrics are zero/empty (no errors). (FR-1)

## US-2 — Snapshot maintenance
- **AC-3:** Given G-RAVI checks out of a 4th stay, when any of the **full folio-mutating set** — `FolioCharged`, `PaymentReceived`, `PaymentRefunded`, `DiscountApplied`, `InvoiceIssued` (incl. `CREDIT_NOTE`/void) — or `GuestCheckedOut`/`FeedbackReceived` fires, then `GuestStatsSnapshot` is recomputed (via `06.guestBilling`) and updated idempotently (a re-delivered event causes no double count); a `PaymentRefunded` or credit-note reduces revenue/adjusts outstanding to still match 06/14. (FR-2)
- **AC-4:** Given the snapshot drifts from a fresh derivation, when the reconciliation job runs, then it recomputes from source (reservations/folios win). (FR-5)

## US-3 — History views
- **AC-5:** Given G-RAVI, when the profile history tab loads, then payment history, feedback history, and previous bills (links to 06 invoice PDFs) are shown. (FR-3)

## US-4 — Permission & consistency
- **AC-6:** Given U-REC (no financial permission), when viewing history, then revenue/outstanding are hidden/masked; stay counts remain. (FR-4)
- **AC-7:** Given the same guest revenue read here and in 14, then they match to the paisa (both derive via `06.guestBilling`/reporting). (FR-6)
- **AC-8:** Given G-RAVI2 is merged into G-RAVI, when `GuestMerged` fires, then **both** snapshots are recomputed — G-RAVI (survivor) absorbs the combined history and G-RAVI2 (loser) is zeroed/merged-away — idempotently. (FR-2b)
