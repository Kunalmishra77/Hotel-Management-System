# 09 · Staff Management — User Stories & Acceptance Criteria

Roles per `rules/user-roles.md`. Staff PII masked by default.

## Test Fixtures
| Ref | Entity | Value |
|---|---|---|
| PROP-A | Property | tz Asia/Kolkata |
| S-ANU | Staff | Housekeeping dept, ₹31,000/mo, joined 2025-01-01, Aadhaar `XXXX XXXX 9012` |
| DAY | Attendance day | 2026-07-12 |
| U-MGR | User | MANAGER (`staff:manage`) |
| U-REC | User | RECEPTION (no `staff:manage`) |
| CLOCK | Injected clock | worked-minutes math |

## US-1 — Staff records
- **AC-1:** Given U-MGR, when creating S-ANU with required fields, then a `Staff` persists (Aadhaar/PAN stored masked, bank encrypted); `StaffCreated` emitted + audited. (FR-1/8)
- **AC-2:** Given missing mobile or salary ≤ 0, when saving, then rejected; nothing persists. (FR-2)
- **AC-3:** Given U-REC (no `staff:manage`), when creating/editing staff, then `FORBIDDEN`. (FR-8)
- **AC-4:** Given a viewer without authorization, when viewing a staff list, then Aadhaar/PAN/bank are masked; `fullName`/department visible. (FR-7)

## US-2 — Attendance
- **AC-5:** Given S-ANU checks in 09:00 and out 17:30 on DAY, when recorded, then `workedMinutes = 510`, unique `(staffId, day)`. (FR-3/4)
- **AC-6:** Given check-out 08:00 before check-in 09:00, when submitted, then rejected. (FR-5)
- **AC-7:** Given DAY marked leave, when recorded, then `isLeave=true`, no worked minutes; 90 overtime minutes on another day persists. (FR-4)
- **AC-8:** Given a second attendance row for S-ANU on DAY, when submitted, then rejected (unique per day). (FR-3)

## US-3 — Monthly summary & payroll feed
- **AC-9:** Given S-ANU's July attendance, when the monthly summary for (PROP-A, 2026-07) is requested, then it returns employed days, worked days, leave days, total overtime minutes — headcount/cost context for 08/14; its `employedDays` matches 21's pay-basis definition and is non-authoritative. (FR-6)
- **AC-11:** Given (PROP-A, 2026-07), when `getStaffForPayroll` is called, then it returns each employed staff member's `monthlySalaryPaise`, `joinedOn`, `leftOn`, `isActive`, and **raw per-day attendance** (`day`, `isLeave`, `leaveType`, `workedMinutes`, `overtimeMinutes`) — so 21 derives `lopDays`/`paidDays`/`employedDays` itself; no bank/PII is in the payload. (FR-10)

## US-4 — Lifecycle
- **AC-10:** Given S-ANU is deactivated, when recording new attendance or running payroll, then they are excluded but history is retained. (FR-9)
