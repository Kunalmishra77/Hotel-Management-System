# 11 · Maintenance — Design

## Schema slice (from canonical `prisma/schema.prisma`)
Owns `MaintenanceJob` (index `(propertyId, status)`, `(scheduledFor)`; `priority` `MaintenancePriority` enum, `roomBlockId` → `RoomBlock` — **both confirmed present in canonical schema**; date-ranged out-of-order via `RoomBlock`, not by overloading room status). Config in `lib/constants/maintenance.ts` (`MAINTENANCE_PREVENTIVE_REMINDER_LEAD_DAYS`, default 3).

## Domain layer (pure) — `features/maintenance/domain/`
- `canTransition(from, to)` — OPEN→IN_PROGRESS→CLOSED (FR-6).
- `nextPreventiveDate(schedule, from)` — recurrence (FR-4).

## Application — server actions (`features/maintenance/actions.ts`)
Per `api-conventions.md`; `maintenance:manage`.
- `createJob(input)` — manual or from 10 complaint; `MaintenanceJobCreated`. (FR-1/2)
- `startJob/closeJob(id, {costPaise})` — transitions; on close unblock room; `MaintenanceJobClosed`. (FR-5/6)
- `blockRoomForJob(jobId, range, {force?})` — checks 03 for a confirmed/in-house reservation overlapping `range` on the room; if present and not `force`, returns `ROOM_HAS_RESERVATION` (conflict surfaced, staff reallocate via `03.reallocateRoom`); `force` requires the reservation already moved, else still rejected — then calls 02 `blockRoom(roomId, range, reason, jobId)` and links `roomBlockId`. Never overlaps a live reservation. (FR-3)
- Preventive scheduler (pg-boss): emit `MaintenanceScheduled` `MAINTENANCE_PREVENTIVE_REMINDER_LEAD_DAYS` (default 3) before `scheduledFor`; recur via `nextPreventiveDate`. (FR-4)

## UI — wireframes (mobile-first, `features/maintenance/components/`)
```
┌───────────────────────────┐
│ Maintenance · MG Road     │
│ 🔴 AC R-103  HIGH  OPEN   │
│  [Start][Block room]      │
│ 🟡 Plumbing R-201 IN-PROG │
│  [Close ₹___]             │
│ Preventive ▸ Pest (5d)    │
└───────────────────────────┘
```
Job list by status/priority; close captures cost; preventive schedule view.

## Events
Emits: `MaintenanceJobCreated`, `MaintenanceScheduled`, `MaintenanceJobClosed`. Consumes: housekeeping complaint (10). Catalog: `docs/architecture/domain-events.md`.

## Error catalog
`ILLEGAL_TRANSITION`, `ROOM_HAS_RESERVATION`, `FORBIDDEN`, `VALIDATION_FAILED`.

## Edge cases
- Blocking a room with an overlapping confirmed/in-house reservation → `ROOM_HAS_RESERVATION` (rejected + surfaced); staff reallocate via `03.reallocateRoom` first, or use `force` only after the reservation is moved — a block never coexists with a live reservation on the same room-nights (AC-8).
- Preventive recurrence idempotent per due date; reminder fires `MAINTENANCE_PREVENTIVE_REMINDER_LEAD_DAYS` before the due date.
- Close without unblocking a non-blocked room → no-op on block.
