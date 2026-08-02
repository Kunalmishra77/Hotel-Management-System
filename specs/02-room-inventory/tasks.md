# 02 · Room Inventory — Tasks

Ordered, test-first for domain. Each ends at `rules/definition-of-done.md`. `(AC-n)/(FR-n)` = traceability.

## Schema & migration
- [x] T-1 Confirm `RoomCategory`/`Room`/`RoomBlock` slice (all **present in canonical schema**) + indexes `(propertyId,number)` unique, `(propertyId,status)`, `RoomBlock(roomId,startDate,endDate)`; materialize the migration slice. (FR-1/2/3/7)
- [x] T-2 `RoomBlock` is **confirmed in the canonical schema** — 02 owns the table, `11.blockRoom` writes it (via `02.blockRoom`), `03` reads it for availability exclusion. No architect decision pending; wire `blockRoom/unblockRoom` to write/remove `RoomBlock` rows. (FR-7)
- [x] T-3 Seed fixtures (PROP-A, categories, rooms, users). 

## Domain (write tests first)
- [x] T-4 `canTransition()` full state machine incl. illegal edges (maint→occupied) **and the cancel/no-show resets `RESERVED→VACANT`, `OCCUPIED→VACANT`** (03 AC-12/AC-22). (FR-5, AC-6/AC-14)
- [x] T-5 Role-gated transition rules (incl. Reception-driven cancel/no-show resets via 03). (AC-7)

## Application (integration tests)
- [x] T-6 `createCategory/updateCategory` (rate paise, occupancy, HSN). (FR-1, AC-1)
- [x] T-7 `createRoom/updateRoom` with number-uniqueness. (FR-2/3, AC-2/3)
- [x] T-8 `changeRoomStatus` validates transition + role + emits `RoomStatusChanged` + audit. (FR-4/6, AC-4/5)
- [x] T-9 `blockRoom/unblockRoom` write/remove a `RoomBlock` row (date-ranged); 03 availability excludes a room with an overlapping block and includes it once the block ends/is removed. (FR-7, AC-8/9)
- [x] T-10 `deactivateRoom` excluded from availability. (FR-8, AC-13)
- [x] T-11 RBAC: housekeeping denied create/delete. (FR-10, AC-12)

## Queries & realtime
- [x] T-12 `roomBoard()` indexed + filters (floor/category/status); p95 budget at 200 rooms. (FR-9, AC-10)
- [x] T-13 `RoomStatusChanged` → live board/overview update < 2s. (AC-11)

## UI (mobile-first)
- [x] T-14 Room board grid with status colors + filters. (AC-10)
- [x] T-15 Room action bottom sheet (allowed transitions + block). (AC-5/7)
- [x] T-16 Category form. (AC-1)

## E2E
- [x] T-17 Journey: create category → create rooms → change status → see it on the board realtime. (AC-1/2/4/11)

## Done
- [x] T-18 `/review-module` clean; every AC → green test; DoD satisfied.
