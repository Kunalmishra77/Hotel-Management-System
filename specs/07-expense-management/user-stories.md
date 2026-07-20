# 07 · Expense Management — User Stories & Acceptance Criteria

Roles per `rules/user-roles.md`.

## Test Fixtures
| Ref | Entity | Value |
|---|---|---|
| PROP-A | Property | tz Asia/Kolkata |
| E-VEG | Expense | Kitchen/Vegetables, ₹1,200, 12 Jul, cash, bill photo |
| E-ELEC | Expense | Utilities/Electricity, ₹8,000, 12 Jul |
| U-ACC | User | ACCOUNTS (`expense:create` + `expense:approve`) |
| U-REC | User | RECEPTION (no expense perms) |

## US-1 — Record an expense
- **AC-1:** Given U-ACC, when recording E-VEG (head Kitchen, sub Vegetables, ₹1,200, cash, bill photo), then an `Expense` persists, the bill is stored in object storage (reference on row), `ExpenseRecorded` emitted + audited. (FR-1/3)
- **AC-2:** Given amount ≤ 0 or missing head, when saving, then rejected; nothing persists. (FR-2)
- **AC-3:** Given U-REC (no perms), when recording an expense, then `FORBIDDEN`. (FR-7)

## US-2 — Approval
- **AC-4:** Given E-VEG with `status = DRAFT`, when a finalized profit report runs, then it is excluded; after U-ACC approves it (`expense:approve` → `status = APPROVED`, `ExpenseApproved` emitted + audited), it is included. (FR-4)

## US-3 — Rollups
- **AC-5:** Given E-VEG + E-ELEC on 12 Jul, when the daily rollup for PROP-A/12-Jul runs, then total ₹9,200; monthly, property-wise, and head-wise rollups aggregate correctly. (FR-5)

## US-4 — No double count with payroll
- **AC-6:** Given payroll finalized for July (staff salary ₹50,481 via 21), when profit is computed, then salary cost comes from `PayrollFinalized`/`getFinalizedStaffCost`, not a hand-keyed STAFF expense; a STAFF-head entry is only non-payroll staff spend. (FR-6)
- **AC-7:** Given U-ACC records a STAFF-head expense whose subCategory names "Salary"/"Wages"/"Payroll", when saving, then it is **rejected** (`VALIDATION_FAILED`); and a reconciliation test asserts no approved STAFF-head expense overlaps `getFinalizedStaffCost` for the same `(property, month)`. (FR-6)
