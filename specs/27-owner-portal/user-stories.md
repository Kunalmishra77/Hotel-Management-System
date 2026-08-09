# 27 · Owner Portal — User Stories & Acceptance Criteria

**Test fixtures (add to seed):** `USER_OWNER_A` (OWNER @ PROP-A only), `USER_OWNER_AB` (OWNER @ PROP-A + PROP-B), an existing `USER_ADMIN` (owner:manage + owner:payout-manage), `USER_MANAGER` (owner:manage), `USER_RECEPTION_A` (no owner perms). PROP-A `managementFeeBps = 1500` (15%).

## US-1 — Owner signs in and sees only their property
- **AC-1:** Given `USER_OWNER_A`, when they sign in, then the nav shows only owner surfaces (Owner home, Documents, Schedule, Payouts) — no bookings/guests/rates/staff — and every data read is scoped to PROP-A.
- **AC-2:** Given `USER_OWNER_A`, when they request PROP-B financials/docs/payouts by any path, then denied 403 (`OUT_OF_SCOPE`) — an owner never sees a property they don't own, nor another owner's data.
- **AC-3 (no PII):** Given the owner views any surface, then no guest PII, rates, or staff data appears — occupancy is counts only.

## US-2 — Financials (reuse canonical numbers)
- **AC-4:** Given PROP-A has snapshots/folios, when `USER_OWNER_A` opens Owner home for a date range, then revenue, expense, profit, occupancy, and a revenue trend render, and each figure equals the `reports`/`analytics` value for the same range (no recomputation).
- **AC-5:** Given a closed month, when viewed, then figures come from immutable night-audit snapshots (`business-rules.md` §15).

## US-3 — Document vault (two-way, audited)
- **AC-6:** Given `USER_OWNER_A` uploads a PDF, then it is stored encrypted, a `PropertyDocument` row keeps only key+checksum+metadata (`uploadedByRole = OWNER`), `PropertyDocumentUploaded` + an audit row are written.
- **AC-7:** Given a staff member with `owner:manage` uploads a document for PROP-A, then it appears in the owner's vault (`uploadedByRole = STAFF`).
- **AC-8 (download audited, non-public):** Given any vault document, when downloaded, then it streams through an authorized route and an access audit row is written; an unauthenticated request gets no bytes.
- **AC-9 (delete rules):** Given an owner-uploaded document, when `USER_OWNER_A` deletes it, then it is soft-deleted (`deletedAt` set, bytes retained by policy). Given a **staff**-uploaded document, when the owner attempts delete, then denied 403.

## US-4 — Schedule tracker
- **AC-10:** Given PROP-A important dates (GST due, insurance renewal), when the owner opens Schedule, then they list soonest-due first, and a date in the past is flagged overdue.
- **AC-11:** Given upcoming preventive maintenance (module 11) and bookings, when the owner opens Schedule, then maintenance items and an occupancy calendar for PROP-A render read-only (counts only, no guest PII).
- **AC-12 (manage):** Given `USER_MANAGER` (owner:manage), when they add an important date to PROP-A, then it persists + is audited; `USER_OWNER_A` (no owner:manage) attempting the same is denied 403.

## US-5 — Payout (management-fee model)
- **AC-13 (math):** Given PROP-A month with Revenue ₹5,00,000, Expenses ₹1,80,000, `managementFeeBps = 1500`, when a payout is computed, then Fee = ₹75,000 (15% of revenue) and Net = 5,00,000 − 1,80,000 − 75,000 = **₹2,45,000** (24,500,000 paise), all in paise.
- **AC-14 (loss month):** Given Expenses + Fee exceed Revenue, when computed, then Net is negative and shown as a shortfall (never clamped to 0).
- **AC-15 (record idempotent):** Given `USER_ADMIN` records the PROP-A payout for a month, then an `OwnerPayout` row (`COMPUTED`) is created with snapshotted figures, `OwnerPayoutRecorded` + audit written; recording the same `(property, month)` again is a no-op (unique).
- **AC-16 (disbursement):** Given a `COMPUTED` payout, when `USER_ADMIN` marks it paid with a reference, then `status = PAID`, `paidAt` + `paymentRef` set, `OwnerPayoutPaid` + audit written; a paid row is never edited.
- **AC-17 (owner view only):** Given `USER_OWNER_A`, when they open Payouts, then they see the statements (gross/expenses/fee/net/status) and can download a statement PDF, but calling compute or mark-paid is denied 403.

## US-6 — RBAC negatives
- **AC-18:** Given `USER_RECEPTION_A` (no owner perms), when calling any owner-portal action or read, then denied 403.
- **AC-19:** Given `USER_OWNER_A`, when calling `owner:manage` / `owner:payout-manage` actions (set fee, add date, record/pay payout), then denied 403 — owner is read-only outside their own document uploads.
