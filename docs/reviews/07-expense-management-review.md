# /review-module — 07-expense-management

**Date:** 2026-08-02 · **Reviewer:** implementing engineer (self-review, per DoD § Review)
**Depends on:** Tier 0/1 ✅ · storage (00) ✅
**Tier 2.** Feeds 08-profit-reports and 14-analytics (expense side of profit).

Checklist source: [`.claude/commands/review-module.md`](../../.claude/commands/review-module.md)

---

## 1. Traceability — AC → test

**5 domain unit tests** + **8 integration tests** + **1 e2e**. Every AC maps to a test.

| AC | Requirement | Covered by |
|---|---|---|
| AC-1 | Record expense, bill to storage (key on row), `ExpenseRecorded` + audit | `expenses` (create w/ bill) · e2e |
| AC-2 | Amount ≤ 0 / missing head rejected | `expenses` (zero) · schema |
| AC-3 | Reception (no perms) → FORBIDDEN | `expenses` (Reception denied) |
| AC-4 | DRAFT excluded from profit; approve → included, `ExpenseApproved` | `expenses` (approve) · e2e |
| AC-5 | Daily/monthly/head/property rollups (₹9,200 on 12 Jul) | `rollup` (unit) · `expenses` (rollup) · e2e |
| AC-6 | Salary from payroll, not a STAFF expense | `expenses` (STAFF-salary rejected) — see D-1 |
| AC-7 | STAFF-head salary/wages/payroll entry → VALIDATION_FAILED | `expenses` (rejected; non-salary STAFF allowed) |
| AC-8 | Bill stored encrypted, only `billObjectKey` on row | `expenses` (billObjectKey set, contains key) |
| AC-9 | Reject → REJECTED, excluded from rollup, audited | `expenses` (reject) |
| AC-10 | Expense entry Accounts/Manager/Admin only | `expenses` (Reception FORBIDDEN) · permission-map |
| AC-11 | Amount ≤ 0 / invalid head → VALIDATION_FAILED | `expenses` (zero) · schema enum |

---

## 2. Invariants

| Invariant | Status |
|---|---|
| Money in paise | ✅ `amountPaise` integer; ₹→paise at the form boundary |
| Approval gates profit | ✅ `expenseRollup` filters `status=APPROVED` — DRAFT/REJECTED never count (AC-4/9) |
| No salary double-count | ✅ STAFF-head salary/wages/payroll entry rejected; salary's source is payroll (21) — the `07` STAFF head is non-payroll spend only (D-1) |
| Bill PII-safe | ✅ image in encrypted object storage, `billObjectKey` only on the row, never in logs (AC-8) |
| Every mutation: event + audit | ✅ `ExpenseRecorded`/`ExpenseApproved` + audit; reject audited |
| RBAC server-side | ✅ `expense:create`/`expense:approve`, deny-by-default (AC-3/10) |

---

## Decisions

### D-1 · Salary double-count prevented at validation, not just asserted
`reporting.md` says staff salary is counted once — from payroll (21), never also as an 07 STAFF
expense. 07 enforces this at the write boundary: a STAFF-head entry whose sub-category names
salary/wages/payroll is rejected (`VALIDATION_FAILED`). The full reconciliation guard (no approved
STAFF expense overlapping `21.getFinalizedStaffCost` for a `(property, month)`) completes when 21
lands; 07 provides the mechanism that makes the overlap impossible to key in.

---

## Findings

### F-1 · Non-blocking · Rollup day-bucketing is UTC, not property-local
`rollup` groups by the `@db.Date` UTC calendar parts. For `Asia/Kolkata` (+5:30, no DST) and
date-only `spentOn`, this matches the property-local day. A property in a timezone that crosses the
UTC date line at its business-day boundary would need tz-aware bucketing. **Action:** revisit if a
non-IST property is onboarded (consistent with the platform's IST-first assumptions).

### F-2 · Non-blocking · Bill capture is a key-only upload, no in-form camera yet
The action stores a base64 bill to encrypted storage; the UI wires the fields but not a `capture`
camera input. **Action:** add `<input type="file" accept="image/*" capture>` when the mobile capture
flow is prioritised (the storage + row path is done and tested).

---

## Carried risks

- **R-1..R-11** from earlier modules — unchanged.
- No new module-specific risk: 07 is self-contained (new files only, no shared-lib changes).
