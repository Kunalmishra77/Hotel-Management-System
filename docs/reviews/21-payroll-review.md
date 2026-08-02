# /review-module — 21-payroll

**Date:** 2026-08-03 · **Reviewer:** implementing engineer (self-review, per DoD § Review)
**Built by:** delegated subagent (parallel Tier-6 batch); **integrated + verified serially by the parent.**
**Depends on:** 09 (`getStaffForPayroll` — the only staff/attendance read). **Consumed by:** 07/08/22 via `PayrollFinalized`; 08 via `getFinalizedStaffCost`.
**Tier 6.** Owns `PayrollRun`, `PayrollLine`, `StaffAdvance` writes.

## 1. Traceability — AC → test
**48 unit** + **7 integration** + **1 e2e**.

| AC | Requirement | Covered by |
|---|---|---|
| AC-1 | Eligibility exclusions | `employed-days` unit · integration (excludes S-EX) |
| AC-2/3 | base pay half-up, full + pro-rated; employed-days (mid-month) | `pay` + `employed-days` unit |
| AC-4 | overtime | `pay` unit |
| AC-5/12 | net = deduction-before-advance, floor 0, carry-forward | `pay` unit · integration (advance recovered) |
| AC-6/7 | adjustLine re-derive + override needs reason + `payroll:run` | integration |
| AC-8/11 | finalize → lock + `PayrollFinalized` + `getFinalizedStaffCost` reflects | integration |
| AC-9 | RUN_LOCKED on finalized edit; adjustment run at next sequence | integration |
| AC-10 | generateRun idempotent (sequence=1) | integration |
| AC-13/16 | LOP by leaveType; paidDays cap | `lop` unit |
| AC-14 | PII masking on payslips | payslip (masked bank tail only) |
| AC-15 | RBAC deny generate/finalize | integration |
| AC-17 | employedDays authority; reads only via 09 | `employed-days` unit · integration |

## 2. Invariants
| Invariant | Status |
|---|---|
| Staff cost counted once | ✅ payroll is the source; `getFinalizedStaffCost(month)` **preserved verbatim** for 08; `PayrollFinalized` for 07/08/22 |
| Deterministic computation | ✅ pure domain, injected clock; Decimal half-up |
| Reads staff/attendance only via 09 | ✅ `getStaffForPayroll`; no foreign SELECT |
| Finalized run immutable | ✅ `RUN_LOCKED`; corrections via adjustment run (next sequence) |
| Deduction before advance, floor 0 | ✅ `netPaise`; advance carry-forward via `StaffAdvance.recoveredPaise` |

## Decisions
- **D-1:** `getFinalizedStaffCost(propertyIds, month)` kept exactly (08 depends on it); a separate `getFinalizedStaffCostInRange` added.
- **D-2:** `RUN_EXISTS`/`OVERRIDE_REASON_REQUIRED` mapped to existing `CONFLICT`/`REASON_REQUIRED` codes (no `errors.ts` edit needed).
- **D-3:** scoped `payrollRun.update` → `updateMany` (scoped-client fix); payslip PDF post-commit + non-fatal (mirrors 06's invoice PDF).

## Carried risks
- **R-38** Bank tail omitted from payslips (no sanctioned masked-bank read in 09 without a foreign SELECT) — a `09.getStaffPayrollPII` masked read is the correct future source.
- **R-39** `PayrollLine` immutability after finalize is enforced at the app layer (`RUN_LOCKED`), not a DB trigger; the post-finalize `payslipObjectKey` update relies on that.
