# 11 · Maintenance — User Stories & Acceptance Criteria

Roles per `rules/user-roles.md`.

## Test Fixtures
| Ref | Entity | Value |
|---|---|---|
| PROP-A | Property | tz Asia/Kolkata |
| R-103 | Room | Deluxe |
| J-AC | MaintenanceJob | AC not cooling, R-103, priority HIGH |
| J-PEST | Preventive | pest control, scheduledFor monthly |
| RES-103 | Reservation | CONFIRMED on R-103, 14–15 Jul (for block-conflict test) |
| U-MNT | User | MAINTENANCE @ PROP-A (`maintenance:manage`) |
| U-REC | User | RECEPTION (no maintenance perms) |
| CLOCK | Injected clock | reminder/schedule tests |

## US-1 — Job lifecycle
- **AC-1:** Given U-MNT creates J-AC for R-103, then a `MaintenanceJob(OPEN)` persists; `MaintenanceJobCreated` emitted + audited. (FR-1/2)
- **AC-2:** Given a housekeeping complaint (from 10) for R-103, then a job is auto-created referencing the room. (FR-2)
- **AC-3:** Given J-AC needs R-103 out of service 14–15 Jul and R-103 is free those dates, when blocked, then 03 excludes R-103 from availability for those dates; unblocking on close restores it. (FR-3/5)
- **AC-8:** Given R-103 has a **confirmed reservation** overlapping 14–15 Jul, when `blockRoomForJob` is attempted, then it is **rejected** (`ROOM_HAS_RESERVATION`) and the conflict is surfaced; the block succeeds only after the guest is reallocated via `03.reallocateRoom` (or `force` after the move) — a room block **never** coexists with an overlapping confirmed reservation (inverse of no-overbooking). (FR-3)
- **AC-4:** Given J-AC IN_PROGRESS, when closed with cost ₹1,500, then `closedAt` stamped, cost captured, room unblocked, `MaintenanceJobClosed` emitted. (FR-5)
- **AC-5:** Given J-AC CLOSED, when reopened directly (CLOSED→OPEN), then rejected (illegal transition). (FR-6)

## US-2 — Preventive
- **AC-6:** Given J-PEST scheduled monthly, when the pg-boss tick reaches `MAINTENANCE_PREVENTIVE_REMINDER_LEAD_DAYS` (default 3) before `scheduledFor`, then `MaintenanceScheduled` is emitted (12 reminds); the schedule recurs. (FR-4)

## US-3 — Permission
- **AC-7:** Given U-REC (no perms), when creating/closing a job, then `FORBIDDEN`. (FR-7)
