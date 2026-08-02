# 07 · Expense Management — Tasks

Test-first for rollups. Each ends at `rules/definition-of-done.md`. `(AC-n)/(FR-n)`.

## Schema & migration
- [x] T-1 Confirm `Expense` + `ExpenseStatus`/`ExpenseHead` enums (**confirmed present in canonical schema** — no `isApproved`); indexes `(propertyId,spentOn)`, `(propertyId,head)`; migration materializes the slice.
- [x] T-2 Seed fixtures (E-VEG, E-ELEC).

## Domain (tests first)
- [x] T-3 `rollup` daily/monthly/property/head (reused by 08/14). (FR-5, AC-5)

## Application (integration tests)
- [x] T-4 `createExpense` validate (incl. STAFF-head salary/wages/payroll guard → `VALIDATION_FAILED`) + bill store + event + audit. (FR-1/2/3/6, AC-1/2/7)
- [x] T-5 `approveExpense` sets `status=APPROVED` + `ExpenseApproved` / `rejectExpense` sets `REJECTED`; non-approved excluded from finalized profit. (FR-4, AC-4)
- [x] T-6 `expenseRollup` (filters `status=APPROVED`) for 08/14. (FR-5, AC-5)
- [x] T-7 Double-count guard: STAFF-head salary entry rejected + reconciliation test asserts no approved STAFF-head expense overlaps `21.getFinalizedStaffCost` for the same `(property, month)`. (FR-6, AC-6/7)
- [x] T-8 RBAC: non-accounts denied. (FR-7, AC-3)

## UI (mobile-first)
- [x] T-9 Expense entry with photo capture. (AC-1)
- [x] T-10 Approval queue + rollup views. (AC-4/5)

## E2E
- [x] T-11 Journey: record expense with bill → approve → appears in daily/monthly rollup + profit. (AC-1/4/5)

## Done
- [x] T-12 `/review-module` clean; every AC → green test; DoD satisfied.
