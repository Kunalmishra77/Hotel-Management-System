# 21 · Payroll — Design

## Schema slice (from canonical `prisma/schema.prisma`)
Owns `PayrollRun` (incl. `sequence`, `runType`, unique `(propertyId, month, sequence)`), `PayrollLine`. Reads `Staff`/`Attendance` (via 09 `getStaffForPayroll`), `Property` (tz/day basis).

**Schema notes:** `PayrollRun.finalizedAt/finalizedById/netTotalPaise`, `PayrollRun.sequence/runType`, `PayrollRunStatus` enum (DRAFT|FINALIZED), `PayrollLine.payslipObjectKey/paidDays/lopDays/otMinutes/notes/createdAt`, `StaffAdvance(id, staffId, amountPaise, recoveredPaise, ...)`, `Attendance.leaveType` (`LeaveType`) are **all confirmed present in canonical schema** — a migration materializes the slice, nothing is new. Config in `lib/constants/payroll.ts`.

## Domain layer (pure, heavily tested) — `features/payroll/domain/`
- `employedDays(month, joinedOn, leftOn, tz): number` — **21 owns this** (the single authority for the pay basis; FR-3).
- `lopDays(attendance[], employedDays, cfg): number` — LOP from `leaveType`: `UNPAID` day → LOP; `PAID`/`CASUAL`/`SICK`/worked → paid; a day with no record → `PAYROLL_ABSENCE_IS_LOP` (off=paid, on=LOP); explicit `UNPAID` always LOP (FR-18).
- `paidDays(employedDays, lopDays, daysInBasis): number` — `min(employedDays − lopDays, daysInBasis)`, capped at basis (FR-3).
- `basePaise(monthlySalaryPaise, paidDays, daysInBasis): number` — half-up (FR-3).
- `overtimePaise(otMinutes, monthlySalaryPaise, cfg): number` — half-up (FR-4).
- `netPaise({base, bonus, ot, deduction, advanceOutstanding}): { netPaise, advanceRecovered }` — earnings, then **deduction in full, then advance recovery of the remaining balance** (`min(advanceOutstanding, remainderAfterDeductions)`), floor at 0, report the recovered amount so callers can carry the shortfall forward (FR-5/15).
- `isEligible(staff, month): boolean` (FR-11).

## Application — server actions (`features/payroll/actions.ts`)
Per `api-conventions.md`; `payroll:run` (🔒). Money in paise/Decimal.
- `generateRun(propertyId, month)` — reads eligible staff + raw attendance via **09 `getStaffForPayroll`**; seeds `advancePaise` from each staff member's outstanding `StaffAdvance` balance (`Σ amountPaise − recoveredPaise`); idempotent for the regular run (`sequence=1`); builds DRAFT lines in one tx; emits `PayrollRunGenerated`. (FR-1/2/10)
- `adjustLine(lineId, {bonus?, deduction?, advance?, overrideBase?, overrideOt?, reason?})` — re-derive net; overrides require reason + audit; emits `PayrollLineAdjusted`. (FR-6/13)
- `finalizeRun(runId)` — lock + immutable + `PayrollFinalized` + payslip PDFs; **increments `StaffAdvance.recoveredPaise`** by each line's recovered amount so the outstanding balance carries forward. (FR-7/15)
- `generateAdjustmentRun(propertyId, month)` — a new `PayrollRun` at the next `sequence` (`runType="ADJUSTMENT"`) for corrections to an already-finalized month (FR-8).
- Queries: `getRun`, `listRuns`, `payslip(lineId)` (permissioned, masked PII); **`getFinalizedStaffCost(propertyIds, range)`** — sum of finalized runs' `netTotalPaise` per `(property, month)` for 08 (the canonical read; contracts.md). (FR-12)

## UI — wireframes (mobile-first, `features/payroll/components/`)
```
┌───────────────────────────┐
│ Payroll · Jul 2026 DRAFT  │
│ Anu K   base 31,000       │
│  +OT 2,981 +bonus 2,000   │
│  −ded 500 −adv 1,000      │
│  net ₹34,481   [edit]     │
│ Late J  net ₹16,000       │
│ ── total  ₹50,481 ──      │
│ [Finalize & payslips]     │
└───────────────────────────┘
```
Line editor: bonus/deduction/advance inputs; override base/OT requires a reason field. Payslip = PDF preview/download (permissioned).

## Events
Emits: `PayrollRunGenerated`, `PayrollLineAdjusted`, `PayrollFinalized`. Consumed by 07/08/22/14. Catalog: `docs/architecture/domain-events.md`.

## Sequences
**Generate:** `getStaffForPayroll` (09) → per line compute `employedDays`→`lopDays` (from `leaveType`)→`paidDays` (capped)→base/OT, seed advance from outstanding `StaffAdvance`, compute net (deduction then advance) → INSERT DRAFT run+lines (one tx) + audit + emit `PayrollRunGenerated`. **Finalize:** lock run/lines → increment `StaffAdvance.recoveredPaise` per line → render payslip PDFs → storage → emit `PayrollFinalized` (07/08/22 consume for cost; 08 also pulls via `getFinalizedStaffCost`). **Correction:** `generateAdjustmentRun` at the next `sequence` (`runType="ADJUSTMENT"`), separately audited (never edit a finalized run).

## Error catalog
`RUN_EXISTS`, `RUN_LOCKED`, `OVERRIDE_REASON_REQUIRED`, `FORBIDDEN`, `VALIDATION_FAILED`.

## Edge cases
- Mid-month joiner/leaver → pro-rated `employedDays` (21-owned); `paidDays` capped at `daysInBasis` (AC-3).
- Negative net → floor 0; deduction applied first, then affordable advance; un-recovered shortfall carried forward via `StaffAdvance.recoveredPaise`, re-seeded next month (FR-5/15).
- `leaveType=UNPAID` day → always LOP; `PAID`/`CASUAL`/`SICK` → paid; missing record → config-explicit (`PAYROLL_ABSENCE_IS_LOP`), never silently guessed (FR-18).
- Correction after finalize → new adjustment run (`sequence>1`), never a re-generation of the locked run (FR-8/10).
- Payroll is the **single** source of staff salary cost — surfaced via `PayrollFinalized` + `getFinalizedStaffCost`, not double-counted as a 07 expense (FR-12).
- Rounding half-up per component; run total = Σ line net.
