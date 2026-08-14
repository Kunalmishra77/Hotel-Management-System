# Phase 6 — Approvals escalation + Super-Admin dashboard filters

> Part of the customer-first redesign. Two things: money approvals escalate by
> size (a big spend can't be waved through by a Manager), and the portfolio
> dashboard gains a date lens so owners/admins can compare hotels over a period.

## Part A — Expense approval escalation

**Today:** anyone holding `expense:approve` (Manager 🔒, Accounts 🔒, Admin) can
approve *any* amount. **Blueprint:** minor → Manager, major → Super Admin.

**Design.** A threshold `EXPENSE_ESCALATION_THRESHOLD_PAISE` (₹25,000). A pure
`requiresSuperApproval(amountPaise)`. A new **`expense:approve-large`** permission
(ADMINISTRATOR only, audited). `approveExpense` authorizes the *right* permission
for the amount: over threshold → `expense:approve-large` (only an Administrator
passes; a Manager is refused), else `expense:approve`. The notifications consumer,
on `ExpenseRecorded`, routes an approval alert to the correct approver pool
(Administrators for large, `expense:approve` holders for small), linking to
`/expenses`.

**Tasks**
- [ ] **A1** — `expense:approve-large` in rbac-matrix.md + permission-map.ts (lockstep;
  RBAC sync test green). ADMINISTRATOR 🔒 only.
- [ ] **A2** — `EXPENSE_ESCALATION_THRESHOLD_PAISE` + pure `requiresSuperApproval`
  (+ unit test).
- [ ] **A3** — `approveExpense` picks the permission by amount (over → large).
- [ ] **A4** — notifications consumer handles `ExpenseRecorded` → Administrators
  (large) or `expense:approve` holders (small), link `/expenses`.

## Part B — Super-Admin dashboard date filter

`getPortfolio(user, from, to)` + `perPropertyStats({from,to})` already take a range
and already render a per-property compare grid. Phase 6 adds the **date lens**:

**Tasks**
- [ ] **B1** — `/overview` `?period=` selector (last 7 / 30 / 90 days), validated
  (bad → 30), threaded to `getPortfolio` + `trend`; a small period-toggle UI. The
  per-property compare grid then reflects the chosen window.

## Verify
- Unit: `requiresSuperApproval` boundary; RBAC sync; period validator.
- Integration: a Manager is **refused** approval of a large expense
  (`expense:approve-large` denied) but allowed a small one; an Administrator
  approves the large one; `ExpenseRecorded` notifies the right pool.
- typecheck + lint + build; local-DB run.

## Security / DoD
- Escalation is enforced **server-side** in `approveExpense` (not just UI); the
  large-approval permission is audited (money path). No scope change to reads.

## Out of scope (later)
- Maintenance-cost escalation (same pattern — a follow-up). Configurable
  per-property thresholds (constant for now). New dashboard chart types beyond the
  existing widget set.
