# 10 · Housekeeping — Tasks

Test-first for conflict resolution. Offline is the crux. Each ends at `rules/definition-of-done.md`. `(AC-n)/(FR-n)`.

## Schema & migration
- [x] T-1 Confirm `HousekeepingTask` incl. `clientUpdatedAt`/`serverStatusChangedAt`/`linenChanged`/`towelChanged`/`complaintText`/`raisedMaintenanceJobId` (**confirmed present in canonical schema**); migration materializes the slice; index `(propertyId, status)`.
- [x] T-2 Seed fixtures (R-101 HOUSEKEEPING).

## Domain (tests first)
- [x] T-3 `resolveConflict` compares `clientUpdatedAt` vs `serverStatusChangedAt`; stale (client < server) → reject + surface; fresh → apply subject to 02 transition validation (not blind last-writer-wins). (FR-5, AC-6)
- [x] T-4 `taskFor` on room→HOUSEKEEPING. (FR-2, AC-1)

## Application (integration tests)
- [x] T-5 `updateTaskStatus` DONE → 02 `changeRoomStatus` + events. (FR-3, AC-2/7)
- [x] T-6 `recordHousekeepingDetails` complaint → 11 job. (FR-6, AC-3)
- [x] T-7 `syncOfflineUpdates` applies queue + conflict resolution; no illegal transition. (FR-4/5, AC-4/5/6)
- [x] T-8 RBAC: HK denied financials/PII. (FR-8, AC-8)

## Offline / UI (mobile-first, uses 17)
- [x] T-9 IndexedDB queue + background sync integration. (FR-4)
- [x] T-10 Task board (one-thumb, offline banner, optimistic). (AC-1/2/4)

## E2E
- [x] T-11 Journey (mobile, offline→online): checkout → task appears → mark clean offline → sync → room VACANT + board updates. (AC-1/2/4/5)

## Done
- [x] T-12 `/review-module` clean; every AC → green test; offline path verified; DoD satisfied.
