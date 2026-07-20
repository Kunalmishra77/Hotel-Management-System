# 10 · Housekeeping — Design

## Schema slice (from canonical `prisma/schema.prisma`)
Owns `HousekeepingTask` (offline/conflict fields `clientUpdatedAt` + `serverStatusChangedAt`; `linenChanged`, `towelChanged`, `complaintText`, `raisedMaintenanceJobId` — **all confirmed present in canonical schema**). Room status transitions are owned by 02.

## Domain layer (pure) — `features/housekeeping/domain/`
- `resolveConflict(local, server): Resolution` — compares `local.clientUpdatedAt` vs `server.serverStatusChangedAt`; `clientUpdatedAt < serverStatusChangedAt` ⇒ `{ apply:false, reason:'STALE' }` (reject + surface); otherwise `{ apply:true }` **subject to 02's transition validation** (final guard). Never blind last-writer-wins (FR-5).
- `taskFor(room): HousekeepingTask` — derive a cleaning task when a room enters HOUSEKEEPING.

## Application — server actions (`features/housekeeping/actions.ts`)
Per `api-conventions.md`; `housekeeping:update`.
- `listTasks(propertyId)` — rooms needing attention + status.
- `updateTaskStatus(taskId, status, {clientUpdatedAt})` — on DONE, call `rooms.changeRoomStatus` (02); emit events. (FR-3)
- `recordHousekeepingDetails(taskId, {linen, towel, complaint})` — complaint → `maintenance.createJob` (11). (FR-6)
- `syncOfflineUpdates(batch)` — apply queued updates with conflict resolution. (FR-4/5)

## Offline / PWA (uses 17)
Service-worker background sync; updates written to an IndexedDB queue with their `clientUpdatedAt` when offline; on reconnect, `syncOfflineUpdates` posts them; `resolveConflict` (stale check vs `serverStatusChangedAt`) + 02's transition validation prevent illegal states — stale writes are rejected and surfaced, never silently applied.

## UI — wireframes (mobile-first, `features/housekeeping/components/`)
```
┌───────────────────────────┐
│ Housekeeping · MG Road    │
│ ⚠ 2 pending sync          │
│ R-101  🟠 to clean        │
│  [Start][Clean ✓]         │
│  ☐ Linen ☐ Towel          │
│  📝 complaint…            │
│ R-203  🟢 done            │
└───────────────────────────┘
```
Big one-thumb buttons; offline banner; optimistic status with reconcile.

## Events
Emits: `HousekeepingTaskDone`, (via 02) `RoomStatusChanged`, (via 11) `MaintenanceScheduled`. Consumes: `GuestCheckedOut` (→ create task). Catalog: `docs/architecture/domain-events.md`.

## Error catalog
`ILLEGAL_TRANSITION` (from 02), `FORBIDDEN`, `SYNC_CONFLICT` (surfaced, not fatal).

## Edge cases
- Offline 'clean' for a room re-occupied server-side → `clientUpdatedAt < serverStatusChangedAt` ⇒ rejected as stale + surfaced; 02 also rejects OCCUPIED→VACANT; no illegal transition (AC-6).
- Duplicate queued updates → idempotent by task + clientUpdatedAt.
- Complaint without maintenance need → stored on task, no job raised.
- HK role sees no financials/PII (FR-8).
