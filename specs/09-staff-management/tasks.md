# 09 · Staff Management — Tasks

Test-first for domain. Each ends at `rules/definition-of-done.md`. `(AC-n)/(FR-n)`.

## Schema & migration
- [ ] T-1 Confirm `Staff`/`Attendance` + `Attendance.leaveType` (`LeaveType`) + `StaffDocument` (**confirmed present in canonical schema**); unique `(staffId, day)`; migration materializes the slice.
- [ ] T-2 Seed fixtures (S-ANU, attendance).

## Domain (tests first)
- [ ] T-3 `workedMinutes` incl. overnight/tz. (FR-4, AC-5)
- [ ] T-4 `monthlySummary` (08/14 context; `employedDays` matches 21's definition, non-authoritative). (FR-6, AC-9)
- [ ] T-5 `maskId`. (FR-7, AC-4)

## Application (integration tests)
- [ ] T-6 `createStaff/updateStaff` mask+encrypt+event+audit; validation. (FR-1/2/8, AC-1/2)
- [ ] T-7 `recordAttendance` compute + unique-per-day + validation. (FR-3/4/5, AC-5/6/7/8)
- [ ] T-8 `deactivateStaff` retains history, excludes from payroll. (FR-9, AC-10)
- [ ] T-9 `attendanceSummary` (08/14 context) + `getStaffForPayroll` returning `StaffWithAttendance[]` (salary + joinedOn/leftOn/isActive + raw per-day attendance incl. `leaveType`, no PII) — the read 21 consumes. (FR-6/10, AC-9/11)
- [ ] T-10 RBAC: non-managers denied. (FR-8, AC-3)
- [ ] T-11 PII masking in lists/exports/logs. (FR-7, AC-4)

## UI (mobile-first)
- [ ] T-12 Staff list/profile (masked). (AC-1/4)
- [ ] T-13 Attendance day view (check-in/out/leave/OT). (AC-5/7)

## E2E
- [ ] T-14 Journey: add staff → record attendance across a month → summary feeds payroll. (AC-1/5/9)

## Done
- [ ] T-15 `/review-module` clean; every AC → green test; DoD satisfied.
