# 05 · Guest History — Requirements

> Source: client doc §4. Read with `rules/business-rules.md` §17 (history is derived), `rules/reporting.md`, `prisma/schema.prisma`. Depth bar: `specs/03-reservations/*`.

## Purpose & scope
Present a guest's permanent history — visits, room-nights, revenue, outstanding, preferences, past bills, feedback — all **derived** from reservations/folios/feedback, never hand-maintained. Maintain a `GuestStatsSnapshot` cache for fast profile display, updated via domain events.

**In scope:** derived per-guest metrics (visits, total room-nights, total revenue, outstanding, preferred room/rate, last stay); payment & feedback history; previous bills/invoices list; `GuestStatsSnapshot` maintenance via events; the history tab on the guest profile (04).
**Out of scope:** guest profile/PII writes (04), folio/invoice data (06 — read), reservation data (03 — read), cross-entity search (15).

## Dependencies
- **Tier 0–2:** 00, 04-guest-crm (guest), 03-reservations, 06-billing (folios/invoices/payments), 12-communications (feedback).
- **Consumed by:** 04 (profile history tab), 14 (repeat guests), 25 (corporate history), 15 (search facets).

## Data owned
`GuestStatsSnapshot` (a cache; `totalRevenuePaise`/`outstandingPaise` are **`BigInt` paise** in the canonical schema; `preferredCategoryId`/`preferredRatePaise`/`lastReconciledAt` confirmed present). Reads (via owning modules' query layers, never foreign SELECTs): `Reservation` (03), the guest's billing roll-up via **`06.guestBilling(guestId)`** (folios/invoices/payments), `Feedback` (12).

## Functional requirements (EARS)
- **FR-1 (ubiquitous):** For any guest, derive: number of visits (checked-out reservations), total room-nights, total revenue generated, current outstanding, preferred room category/rate (mode of past stays), last stay date. The financial figures are derived from a **single guest-scoped billing query** exposed by 06 (`billing.guestBilling(guestId)`), not a per-reservation fan-out of folio reads, so the derivation is one call per guest and reconciles to the paisa with 06/14.
- **FR-2 (event):** The snapshot is maintained from the **full set of folio-mutating events** plus stay/feedback/merge events — `FolioCharged`, `PaymentReceived`, `PaymentRefunded`, `DiscountApplied`, `InvoiceIssued` (incl. `CREDIT_NOTE`/void), `GuestCheckedOut`, `FeedbackReceived`, and `GuestMerged` — each handled **idempotently** (event-driven, deduped on event id). On any of these the guest's `GuestStatsSnapshot` is recomputed from source (via `guestBilling`) and upserted.
- **FR-2b (event):** When `GuestMerged` fires, the system shall recompute and upsert the snapshots for **both** the survivor and the loser (the loser's snapshot goes to zero/merged-away; the survivor absorbs the combined history).
- **FR-3 (ubiquitous):** Present payment history, feedback history, and a list of previous bills/invoices (links to 06 PDFs) for a guest.
- **FR-4 (ubiquitous):** All history reads are property/org-scoped and permissioned; financial figures require the relevant permission and PII stays masked per `compliance.md`.
- **FR-5 (unwanted):** If the snapshot and a fresh derivation diverge (drift), a reconciliation job recomputes from source — source of truth is always the underlying reservations/folios, not the cache.
- **FR-6 (ubiquitous):** Every consumer reads the **same** derivation as reporting (`reporting.md`); revenue is net-of-discount, tax-excluded for consistency.

## Non-functional (cited)
Profile history loads fast from the snapshot cache (O(1) per guest); reconciliation runs off the hot path; consistent to the paisa with 06/14. (`non-functional-requirements.md`)

## Business rules referenced
`business-rules.md` §17 (history derived, not stored/hand-maintained), §21 (shown values match source). `reporting.md` (revenue definition).
