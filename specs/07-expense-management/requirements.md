# 07 · Expense Management — Requirements

> Source: client doc §6. Read with `rules/reporting.md` (expense definition), `rules/business-rules.md` §20, `prisma/schema.prisma`. Depth bar: `specs/03-reservations/*`.

## Purpose & scope
Record daily operational expenses per property under standard heads/categories, with approval, and expose expense rollups that profit reporting (08) and the dashboard (14) consume.

**In scope:** expense entry (head, subcategory, amount, date, vendor, pay mode, bill upload); approval workflow; daily/monthly/property/category rollups; bill attachment in object storage.
**Out of scope:** profit computation (08 — reads this), staff salary cost (21/payroll is the single source — salaries are NOT hand-keyed here, FR-6), accounting-provider push (22 — consumes `ExpenseRecorded`), inventory purchase valuation (20).

## Dependencies
- **Tier 0:** 00-platform (auth, tenancy, events, audit, object storage), 01-property-management.
- **Consumed by:** 08-profit-reports, 14-analytics, 22-accounting-sync.

## Data owned
`Expense`. **Schema notes:** `Expense.status` (`ExpenseStatus` enum DRAFT|APPROVED|REJECTED) and the `ExpenseHead` enum are **confirmed present in canonical schema** (`isApproved` never existed). A migration still materializes this slice; nothing here is new.

## Functional requirements (EARS)
- **FR-1 (ubiquitous):** Record each expense as an `Expense` scoped to one property, with `head` (enum), optional `subCategory`, `amountPaise`, `spentOn` (property-local date), optional `vendor`, `paidVia`, and an optional `billObjectKey`.
- **FR-2 (unwanted):** If `amountPaise` ≤ 0 or `head` is missing/invalid, reject at validation; nothing persists.
- **FR-3 (event):** When an expense is created, emit `ExpenseRecorded` and write audit; a bill image, if provided, is stored in encrypted object storage (reference only on the row).
- **FR-4 (state):** While an expense's `status` is not `APPROVED` (`DRAFT`/`REJECTED`), it is excluded from finalized profit reports; approval (`expense:approve`) sets `status = APPROVED`, emits `ExpenseApproved`, and includes it. Rollups consumed by 08/14 filter on `status = APPROVED`.
- **FR-5 (ubiquitous):** Provide rollups: **daily**, **monthly**, **property-wise**, and **category(head)-wise** totals over a date range, property-scoped.
- **FR-6 (unwanted):** Never double-count staff salary against payroll — salary cost comes from `PayrollFinalized` (21), not a hand-keyed expense; the STAFF head is for non-payroll staff spend (advances outside payroll, reimbursements) only. **Guard:** a STAFF-head entry whose subCategory names salary/wages/payroll is **rejected at validation** (`VALIDATION_FAILED`), and a reconciliation test asserts that no approved STAFF-head expense overlaps the `getFinalizedStaffCost` figure for the same `(property, month)` — so the double-count cannot occur silently rather than merely being asserted by convention.
- **FR-7 (ubiquitous):** Every expense mutation is property-scoped, authorized server-side (`expense:create`/`expense:approve`), audited, and emits its domain event.

## Non-functional (cited)
Expense entry usable one-handed on a phone with a photo of the bill; rollup queries within list budgets via indexes `(propertyId, spentOn)`, `(propertyId, head)`; money in paise. (`non-functional-requirements.md`)

## Business rules referenced
`business-rules.md` §20 (validate→authorize→transaction→event→audit); `reporting.md` (expenses = Σ approved entries by head; profit = revenue − expenses).
