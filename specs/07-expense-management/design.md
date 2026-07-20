# 07 · Expense Management — Design

## Schema slice (from canonical `prisma/schema.prisma`)
Owns `Expense` (indexes `(propertyId, spentOn)`, `(propertyId, head)`). **Schema notes:** `Expense.status` (`ExpenseStatus` enum DRAFT|APPROVED|REJECTED) is **confirmed present** — there is no `isApproved` field (it never existed); the `ExpenseHead` enum (Housekeeping/Kitchen/Maintenance/Utilities/Staff/Administration/Misc, per client §6) is **confirmed present**.

## Domain layer (pure) — `features/expenses/domain/`
- `rollup(expenses, groupBy): Map` — daily/monthly/property/head totals (FR-5, reused by 08/14).

## Application — server actions (`features/expenses/actions.ts`)
Per `api-conventions.md`.
- `createExpense(input)` — `expense:create`; validate (incl. STAFF-head salary/wages/payroll guard → `VALIDATION_FAILED`, FR-6); store bill; `ExpenseRecorded` + audit. (FR-1/2/3/6)
- `approveExpense(id)` — `expense:approve`; sets `status = APPROVED`, emits `ExpenseApproved` + audit. `rejectExpense(id, reason)` sets `status = REJECTED`, audited. (FR-4)
- Queries `expenseRollup(propertyIds, range, groupBy)` for 08/14 — filters `status = APPROVED`. (FR-5)

## UI — wireframes (mobile-first, `features/expenses/components/`)
```
┌───────────────────────────┐
│ Expenses · MG Road [+ Add]│
│ Head [Kitchen ▾]          │
│ Sub  [Vegetables]         │
│ Amount ₹[1200]  Cash ▾    │
│ Date [12 Jul]  📷 bill    │
│         [Save]            │
│ ── Today ₹9,200 ──        │
│ ⏳ Vegetables 1,200 (appr)│
└───────────────────────────┘
```
Photo-first bill capture; approve queue for accounts.

## Events
Emits: `ExpenseRecorded`, `ExpenseApproved`. Consumed by 08/14/22. Catalog: `docs/architecture/domain-events.md`.

## Error catalog
`VALIDATION_FAILED`, `FORBIDDEN`.

## Edge cases
- STAFF head vs payroll → payroll is the salary source; STAFF head = non-payroll spend only. A salary/wages/payroll-named STAFF entry is rejected at validation, and a reconciliation test guards against overlap with `21.getFinalizedStaffCost` (FR-6) — a mechanism, not just an assertion.
- Non-approved (`DRAFT`/`REJECTED`) expenses excluded from finalized profit (FR-4) but visible as pending.
- Bill image stored encrypted; reference only on row.
