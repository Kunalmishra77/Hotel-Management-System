# 10 · Housekeeping — Requirements

> Source: client doc §9. Read with `rules/mobile-first.md` (offline + background sync), `rules/business-rules.md` §18 (room status), `prisma/schema.prisma`. Depth bar: `specs/03-reservations/*`.

## Purpose & scope
Let housekeeping staff update room cleaning status **from a phone, offline-capable**, track linen/towel changes and guest complaints, and drive the room status back to VACANT when clean — feeding availability (02/03) and the live board (01/14).

**In scope:** housekeeping task list per property; room cleaning status updates (dirty→in-progress→clean); linen/towel change tracking; complaint capture (which may raise a maintenance job in 11); **offline queue + background sync** with conflict resolution; assignment to staff.
**Out of scope:** the room status enum/state machine (02 owns it — this module calls `rooms.changeRoomStatus`); maintenance jobs (11 — complaints hand off); staff records (09).

## Dependencies
- **Tier 0:** 00-platform, 01-property-management, 02-room-inventory (`changeRoomStatus`), 17-mobile-experience (PWA/offline substrate).
- **Consumed by:** 02/03 (availability via status), 14 (board), 11 (complaint→maintenance).

## Data owned
`HousekeepingTask`. **Schema notes:** its offline/conflict fields (`clientUpdatedAt`, `serverStatusChangedAt`) and `linenChanged`/`towelChanged` booleans, `complaintText`, `raisedMaintenanceJobId` are **confirmed present in canonical schema**. Migration materializes the slice; nothing is new.

## Functional requirements (EARS)
- **FR-1 (ubiquitous):** Present a housekeeping task list per property showing each room needing attention with its cleaning status (PENDING/IN_PROGRESS/DONE) and assignment.
- **FR-2 (event):** When a room becomes `HOUSEKEEPING` (after checkout, via 03), create/queue a cleaning task for it.
- **FR-3 (event):** When staff mark a room clean, call `rooms.changeRoomStatus(HOUSEKEEPING→VACANT)` (02) so it returns to availability; emit `RoomStatusChanged` (via 02) and `HousekeepingTaskDone`.
- **FR-4 (state):** While the device is **offline**, allow status updates to be captured locally and **queued**; when connectivity returns, sync them with a server timestamp.
- **FR-5 (unwanted):** If an offline update conflicts with a server change (e.g. room already re-occupied), resolve by comparing the offline write's `clientUpdatedAt` against the task's authoritative `serverStatusChangedAt`: if `clientUpdatedAt < serverStatusChangedAt` the offline write is **stale** — **reject it (do not apply), surface the conflict to the user for re-check**, and leave server state untouched. A newer offline write is applied **only if 02's transition validation accepts it**; 02 is the final guard, so an illegal transition (e.g. a stale 'clean' arriving after the room was re-occupied → OCCUPIED→VACANT) is rejected regardless of timestamps. This is not blind last-writer-wins: a stale offline 'clean' can never overwrite a re-occupation.
- **FR-6 (ubiquitous):** Record linen change, towel change, and free-text complaints per task; a complaint may create a `MaintenanceJob` (11) referencing the room.
- **FR-7 (ubiquitous):** Every housekeeping mutation is property-scoped, authorized (`housekeeping:update`), audited, and (where status changes) emits its domain event.
- **FR-8 (unwanted):** If a housekeeping user attempts an action outside their role (e.g. viewing folio/financials), deny server-side.

## Non-functional (cited)
Works on a phone on weak Wi-Fi; **offline updates queue and sync** within seconds of reconnect; status change reflects on other devices < 2s (LISTEN/NOTIFY→SSE); touch targets ≥44px. (`non-functional-requirements.md`, `mobile-first.md`)

## Business rules referenced
`business-rules.md` §18 (room status set + valid transitions — enforced by 02), §20 (validate→authorize→transaction→event→audit).
