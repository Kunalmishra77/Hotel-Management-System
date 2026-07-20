# 21 · Payroll — Tasks

Test-first for all computation (deterministic, injected clock). Each ends at `rules/definition-of-done.md`. `(AC-n)/(FR-n)`.

## Schema & migration
- [ ] T-1 `PayrollRunStatus`, run finalize columns, `PayrollRun.sequence/runType`, line payslip/paidDays/lopDays columns, `StaffAdvance` (incl. `recoveredPaise`), `Attendance.leaveType` are **confirmed present in canonical schema**; `lib/constants/payroll.ts`; migration materializes the slice; unique `(propertyId, month, sequence)`. (FR-1/7/8)
- [ ] T-2 Seed fixtures (S-ANU, S-LATE, S-EX, attendance incl. OT, ATT-UNPAID, ADV-ANU).

## Domain (write tests FIRST)
- [ ] T-3 `employedDays` (mid-month join/leave, tz) — **21 is the single authority**. (FR-3/11, AC-3/17)
- [ ] T-3b `lopDays` from `leaveType` (UNPAID→LOP; PAID/CASUAL/SICK→paid; missing-day config; explicit UNPAID always LOP) + `paidDays` capped at `daysInBasis`. (FR-3/18, AC-13/16)
- [ ] T-4 `basePaise` half-up incl. full + pro-rated. (FR-3, AC-2/3)
- [ ] T-5 `overtimePaise` per formula. (FR-4, AC-4)
- [ ] T-6 `netPaise` — **deduction before advance**, floor-at-0, report recovered amount for carry-forward. (FR-5/15, AC-5/12)
- [ ] T-7 `isEligible` exclusions. (FR-11, AC-1)

## Application (integration tests)
- [ ] T-8 `generateRun` reads via **09 `getStaffForPayroll`**; seeds `advancePaise` from outstanding `StaffAdvance`; regular-run idempotent (`sequence=1`); DRAFT lines one tx; excludes ineligible; emits `PayrollRunGenerated`. (FR-1/2/10, AC-1/10)
- [ ] T-9 `adjustLine` re-derive net + event + audit. (FR-6, AC-6)
- [ ] T-10 Derived-component override requires reason + `payroll:run`. (FR-13, AC-7)
- [ ] T-11 `finalizeRun` lock + immutable + `PayrollFinalized` + payslips; increments `StaffAdvance.recoveredPaise` per line (carry-forward). (FR-7/9/15, AC-8/12)
- [ ] T-12 Finalized edit → `RUN_LOCKED`; `generateAdjustmentRun` at next `sequence` (`runType="ADJUSTMENT"`). (FR-8, AC-9)
- [ ] T-13 `PayrollFinalized` → 07/08/22 cost + **`getFinalizedStaffCost(propertyIds, range)`** synchronous read for 08, not double-counted. (FR-12, AC-11)
- [ ] T-14 LOP-by-`leaveType` + absence config (paid vs LOP); advance carry-forward re-seed next month. (FR-15/18, AC-12/13)
- [ ] T-15 PII masking on lines/payslips/exports. (FR-16, AC-14)
- [ ] T-16 Reads Staff/Attendance only via 09 `getStaffForPayroll` (no foreign SELECT). (FR-17, AC-17)
- [ ] T-17 RBAC: generate/finalize denied without `payroll:run`. (FR-14, AC-15)

## UI (mobile-first)
- [ ] T-18 Run screen + line editor (override reason). (AC-6/7)
- [ ] T-19 Finalize + payslip PDF (permissioned). (AC-8/14)

## E2E
- [ ] T-20 Journey: generate run → adjust a line → finalize → payslip downloadable → cost visible in 08. (AC-1/6/8/11)

## Done
- [ ] T-21 `/review-module` clean; every AC → green test; DoD satisfied.
