# 11 · Maintenance — Requirements

> Source: client doc §10. Read with `rules/business-rules.md` §18 (room blocks), `prisma/schema.prisma`. Depth bar: `specs/03-reservations/*`.

## Purpose & scope
Track maintenance jobs (AC, electrical, plumbing, furniture, painting, pest control) through their lifecycle, schedule **preventive** maintenance with reminders, and block rooms out of availability while under maintenance.

**In scope:** job CRUD + lifecycle (open→in-progress→closed); category/priority; cost capture; preventive schedule + reminders (pg-boss); room block that removes a room from availability (via 02/03); complaint-sourced jobs (from 10).
**Out of scope:** room status enum/transition (02), housekeeping tasks (10), the reminder message send (12 consumes `MaintenanceScheduled`).

## Dependencies
- **Tier 0:** 00-platform (events, audit, pg-boss), 01, 02-room-inventory (room block).
- **Consumed by:** 02/03 (availability via block), 12 (reminders), 14 (cost context).

## Data owned
`MaintenanceJob`. **Schema notes:** `MaintenanceJob.priority` (`MaintenancePriority` enum LOW|NORMAL|HIGH|URGENT) and the `RoomBlock` link (`MaintenanceJob.roomBlockId` → `RoomBlock` for date-ranged out-of-order) are **confirmed present in canonical schema**. Migration materializes the slice; nothing is new.

## Functional requirements (EARS)
- **FR-1 (ubiquitous):** Represent each job as a `MaintenanceJob` scoped to a property, with category, description, `status` (OPEN/IN_PROGRESS/CLOSED), priority, optional room, optional `costPaise`, reporter.
- **FR-2 (event):** When a job is created (manually or from a housekeeping complaint via 10), emit `MaintenanceJobCreated` and audit.
- **FR-3 (state):** While a job requires a room out of service, block that room for a date range (via 02 `blockRoom`) so 03 excludes it from availability; unblock on close. **If the range overlaps a confirmed/in-house reservation on that room, the block is rejected by default** (`ROOM_HAS_RESERVATION`) and the conflict is surfaced so staff first reallocate the guest via `03.reallocateRoom`; only an explicit **force** path may proceed, and it requires the overlapping reservation to be moved first — a block must **never** silently coexist with a confirmed reservation on the same room-nights (no back-door overbooking).
- **FR-4 (ubiquitous):** Support **preventive** jobs (`isPreventive`) with a `scheduledFor` date and recurring schedule; a pg-boss job emits `MaintenanceScheduled` a configurable **lead time** ahead of the due date (`MAINTENANCE_PREVENTIVE_REMINDER_LEAD_DAYS`, default 3 days, in `lib/constants/maintenance.ts`) so 12 can remind.
- **FR-5 (event):** When a job is closed, stamp `closedAt`, capture cost, unblock the room if blocked, emit `MaintenanceJobClosed` + audit.
- **FR-6 (unwanted):** If an illegal status transition is requested (e.g. CLOSED→OPEN), reject it.
- **FR-7 (ubiquitous):** Every maintenance mutation is property-scoped, authorized (`maintenance:manage`), audited, and emits its domain event.

## Non-functional (cited)
Job list + updates usable on a phone; preventive reminders fire reliably via pg-boss; room-block reflects in availability immediately. (`non-functional-requirements.md`)

## Business rules referenced
`business-rules.md` §18 (room out-of-order affects availability), §20 (validate→authorize→transaction→event→audit).
