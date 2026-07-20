# 21 · Payroll — User Stories & Acceptance Criteria

Roles per `rules/user-roles.md`; `payroll:run` is 🔒 audited. Reads 09's Staff/Attendance only via its query layer.

## Test Fixtures
| Ref | Entity | Value |
|---|---|---|
| PROP-A | Property | tz Asia/Kolkata |
| MONTH | Payroll month | `2026-07` (31 calendar days) |
| S-ANU | Staff | ₹31,000/mo, joined 2025-01-01, active |
| S-LATE | Staff | ₹31,000/mo, joined 2026-07-16 (mid-month) |
| S-EX | Staff | left (deletedAt 2026-06-30) — excluded |
| ATT-OT | Attendance | S-ANU: 600 overtime minutes over the month |
| ATT-UNPAID | Attendance | S-ANU: 2 days `leaveType=UNPAID`; 1 day `leaveType=SICK` |
| ADV-ANU | StaffAdvance | S-ANU: amountPaise ₹40,000, recoveredPaise ₹0 (outstanding ₹40,000) |
| CFG | Config | PAYROLL_DAY_BASIS=calendar(31), OT_DIVISOR_DAYS=26, STD_MIN/DAY=480, OT_MULT=2.0, ABSENCE_IS_LOP=off |
| U-ACC | User | ACCOUNTS (`payroll:run`) |
| CLOCK | Injected clock | deterministic month math |

## US-1 — Generate a run
- **AC-1:** Given MONTH for PROP-A, when U-ACC generates the run, then one **regular** `PayrollRun(DRAFT, sequence=1, runType="REGULAR")` per `(PROP-A, 2026-07)` with one `PayrollLine` per eligible staff; eligible staff + raw attendance are read via **09 `getStaffForPayroll`**; S-EX excluded (left before month); `PayrollRunGenerated` emitted. (FR-1/2/11)
- **AC-2:** Given S-ANU full month, when computed, then `basePaise = 31000×31/31 = ₹31,000`. (FR-3)
- **AC-3:** Given S-LATE joined 16 Jul (employedDays 16 of 31), when computed, then `basePaise = round(31000×16/31) = ₹16,000` (₹1,600,000 paise, half-up). (FR-3)
- **AC-4:** Given S-ANU 600 OT minutes: ordinaryRate/min = 3,100,000 ÷ (26×480) = 248.397 paise; OT = round(600 × 248.397 × 2.0) = ₹2,981 (298,077 paise). (FR-4)
- **AC-5:** Given base ₹31,000, bonus ₹2,000, OT ₹2,981, deduction ₹500, advance ₹1,000, then `netPaise = 31000+2000+2981−500−1000 = ₹34,481`. (FR-5)

## US-2 — Draft editing
- **AC-6:** Given a DRAFT run, when U-ACC edits bonus/deduction/advance on a line, then `netPaise` re-derives, an audit row is written, `PayrollLineAdjusted` emitted. (FR-6)
- **AC-7:** Given a manual override of a **derived** component (base/OT) away from computed, when saved without a reason, then rejected; with `payroll:run` + reason, accepted + audited override. (FR-13)

## US-3 — Finalize & immutability
- **AC-8:** Given a DRAFT run, when finalized, then run + lines lock (append-only), `finalizedAt/By` stamped, status FINALIZED, `PayrollFinalized` emitted, one payslip PDF per line rendered to access-controlled storage. (FR-7)
- **AC-9:** Given a FINALIZED run, when any line is edited/deleted/regenerated, then `RUN_LOCKED`; corrections only via a **new adjustment run** at the next `sequence` (`runType="ADJUSTMENT"`), permitted by the `(propertyId, month, sequence)` unique key. (FR-8/9)
- **AC-10:** Given MONTH already has a regular run (`sequence=1`), when generated again, then no duplicate — returns the existing DRAFT, or `RUN_EXISTS` if FINALIZED (correction goes via an adjustment run, not a re-generation). (FR-10)

## US-4 — Reporting integration (no double count)
- **AC-11:** Given a finalized run, when `PayrollFinalized` is emitted, then 07/08/22 receive the staff salary cost, and 08 also reads it synchronously via **`getFinalizedStaffCost(propertyIds, range)`** (Σ finalized `netTotalPaise` per `(property, month)`, no foreign SELECT); the same cost is **never** also hand-keyed as a 07 expense. (FR-12)

## US-5 — Edge & compliance
- **AC-12:** Given ADV-ANU outstanding ₹40,000 and a deduction ₹500 on a line whose earnings (base+bonus+OT) are ₹35,981, when net is computed, then deduction ₹500 applies first (remaining ₹35,481), advance recovery takes only that remaining balance (`recovered = min(40,000; 35,481) = ₹35,481`), net floors at 0, `StaffAdvance.recoveredPaise` increments by ₹35,481, and the un-recovered ₹4,519 carries forward to re-seed next month's `advancePaise` — never a negative disbursement. (FR-5/15)
- **AC-13:** Given ATT-UNPAID, then the 2 `UNPAID` days count as LOP (docked) and the `SICK` day is paid; given an employed day with **no** attendance record and ABSENCE_IS_LOP=off, the day is paid (not auto-docked), with the flag on it counts as LOP; an explicit `UNPAID` day is LOP regardless of the flag. (FR-18)
- **AC-16:** Given a staff member whose `employedDays − lopDays` would exceed `daysInBasis` (e.g. over-recorded attendance), when `paidDays` is computed, then it is **capped at `daysInBasis`** so base never exceeds the monthly salary. (FR-3)
- **AC-17:** Given payroll runs, then `employedDays` is computed **only by 21** (the single authority) from the raw `joinedOn`/`leftOn` + attendance supplied by 09 `getStaffForPayroll`; no foreign SELECT into 09's tables. (FR-3/17)
- **AC-14:** Given a viewer without authorization, when viewing lines/payslips, then bank details + masked Aadhaar/PAN are hidden; masked by default in lists/exports. (FR-16)
- **AC-15:** Given U-REC (no `payroll:run`), when generating/finalizing, then `FORBIDDEN`. (FR-14)
