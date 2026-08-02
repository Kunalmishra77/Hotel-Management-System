# 11 · Maintenance — Tasks

Test-first for transitions/recurrence. Each ends at `rules/definition-of-done.md`. `(AC-n)/(FR-n)`.

## Schema & migration
- [x] T-1 Confirm `MaintenanceJob` incl. `priority` (`MaintenancePriority`) + `roomBlockId` → `RoomBlock` (**confirmed present in canonical schema**); `lib/constants/maintenance.ts` (`MAINTENANCE_PREVENTIVE_REMINDER_LEAD_DAYS`); indexes; migration materializes the slice.
- [x] T-2 Seed fixtures (J-AC, J-PEST, RES-103).

## Domain (tests first)
- [x] T-3 `canTransition` incl. illegal CLOSED→OPEN. (FR-6, AC-5)
- [x] T-4 `nextPreventiveDate` recurrence. (FR-4, AC-6)

## Application (integration tests)
- [x] T-5 `createJob` manual + from-complaint; event + audit. (FR-1/2, AC-1/2)
- [x] T-6 `blockRoomForJob` → 02 block → 03 excludes availability; unblock on close; **overlapping confirmed reservation → `ROOM_HAS_RESERVATION` (reject + surface), block only after `03.reallocateRoom` or `force` post-move; never coexists with a live reservation**. (FR-3/5, AC-3/4/8)
- [x] T-7 `startJob/closeJob` transitions + cost + events. (FR-5, AC-4)
- [x] T-8 Preventive scheduler → `MaintenanceScheduled` fires `MAINTENANCE_PREVENTIVE_REMINDER_LEAD_DAYS` before due; recurs. (FR-4, AC-6)
- [x] T-9 RBAC: non-maintenance denied. (FR-7, AC-7)

## UI (mobile-first)
- [x] T-10 Job list by status/priority + close-with-cost. (AC-1/4)
- [x] T-11 Preventive schedule view. (AC-6)

## E2E
- [x] T-12 Journey: create job → block room (unavailable in 03) → close → room available. (AC-1/3/4)

## Done
- [x] T-13 `/review-module` clean; every AC → green test; DoD satisfied.
