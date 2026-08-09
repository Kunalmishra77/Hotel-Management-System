# 27 · Owner Portal — Requirements

**Source:** MoM 2026-08-03 (binding). Property **owners** get a login to see how their property is doing — financials, a document vault, a schedule of what's due, and their payout. Owners are asset owners; the org **operates** the property and charges a management fee.

**Tier:** 3+ (depends on 08-profit-reports, 14-dashboard-analytics, 07-expenses, 03-reservations, 11-maintenance, 00-platform, 16-security). Read-mostly; the only owner write is uploading their own documents.

## Roles & access
- **FR-1 (role):** A new `OWNER` role exists. An owner is a real user assigned `OWNER` **scoped to the properties they own** (reuses the existing user→property assignment; no new link table). An owner may own one or more properties; a property may have more than one owner.
- **FR-2 (deny by default):** Owner permissions are property-scoped and read-only except document upload: `owner:view-financials`, `owner:view-payout`, `owner:view-schedule`, `owner:view-docs`, `owner:upload-docs`. An owner holds **no** operational or management permission — never sees another owner's property, guest PII, rates, or staff data.
- **FR-3 (management side):** Managing owner data is staff-only: `owner:manage` (set a property's management-fee %, manage important dates, upload owner-visible documents) and `owner:payout-manage` (compute + record payouts/disbursements). Held by ADMINISTRATOR (and MANAGER for `owner:manage`); **never** by OWNER. Every such action is authorized server-side, property-scoped, and audited.

## Financials (reuse — never recompute)
- **FR-4:** The owner sees revenue, expense, profit, and occupancy for their property over a date range, plus a revenue trend — computed **only** via the canonical `reports`/`analytics` query layer (`reporting.md`). The portal never recomputes a metric.
- **FR-5:** Closed business dates read immutable night-audit snapshots; open dates read live state (`business-rules.md` §14–15). Figures shown to the owner match the folio/snapshots exactly.

## Document vault
- **FR-6:** A property has a document vault. Both staff (`owner:manage`) and the owner (`owner:upload-docs`) can upload documents (agreements, licences, tax papers, statements). Bytes live in **encrypted object storage** (reuse the storage adapter); the DB row holds only `objectKey` + `checksum` + metadata — never the bytes.
- **FR-7 (access log):** Every upload, download, and delete of a vault document writes an audit record (who, when, which document). Downloads stream through an authorized, **non-public** route (payslip/Form-C pattern).
- **FR-8 (soft-delete):** Documents are soft-deleted (`deletedAt`), never hard-deleted. An owner may delete a document they uploaded; staff with `owner:manage` may delete any in-scope document. An owner cannot delete a staff-uploaded document.

## Schedule tracker
- **FR-9 (important dates):** A property carries owner-relevant **important dates** — licence / GST / AMC / insurance / other renewals — each with a kind, label, due date, and optional note. Managed by `owner:manage`; the owner views them, soonest-due first, with an overdue flag.
- **FR-10 (maintenance + occupancy):** The schedule view also surfaces upcoming **preventive maintenance** (reuse module 11) and an **occupancy calendar** (reuse module 03 `reservationCalendar`) for the owner's property — both read-only, no guest PII beyond occupancy counts.

## Payout (management-fee model — money path)
- **FR-11 (formula):** For a `(property, month)`, grounded on `reporting.md` figures:
  `Revenue` = Σ folio charges net of discount, **tax-excluded**; `Expenses` = 07 approved (excl. STAFF salary) + finalized payroll; `ManagementFee = round_half_up(managementFeeBps / 10000 × Revenue)`; **`NetPayableToOwner = Revenue − Expenses − ManagementFee`** (may be negative in a loss month). All in **paise / `BigInt`**, arithmetic via Decimal.js.
- **FR-12 (statement + ledger):** `owner:payout-manage` computes and **records** a payout for `(property, month)` — snapshotting Revenue, Expenses, feeBps, fee, and net into an append-only `OwnerPayout` row (`status = COMPUTED`). Recording is idempotent per `(property, month)` (unique). Emits `OwnerPayoutRecorded` + audit.
- **FR-13 (disbursement):** Marking a recorded payout **paid** sets `status = PAID` with `paidAt` + `paymentRef`, emits `OwnerPayoutPaid` + audit. Append-only — a correction is a new reversing/re-computed row for a new period, never an edit of a paid row.
- **FR-14 (owner view):** The owner sees their payout statements (period, gross, expenses, fee, net, status) and can download a statement PDF; the owner **cannot** compute or mark payouts.

## Cross-cutting
- **FR-15:** Every mutation (fee change, document upload/delete, important-date CRUD, payout record/pay) is validate → authorize (property-scoped) → transaction → domain event → audit (`business-rules.md` §20).
- **FR-16 (mobile-first):** Owner surfaces are mobile-first and work on a phone (`mobile-first.md`); money shown in ₹, stored in paise.

## Non-functional
Owner dashboard first interaction < 2.5s cold; financial/payout reads within report budgets (`non-functional-requirements.md`); no guest PII or cross-owner leakage under any path.
