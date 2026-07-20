# 02 · Room Inventory — Requirements

> Source: client doc §1 (rooms/categories/floors/status). Read with `rules/business-rules.md` (§18 status transitions, availability), `prisma/schema.prisma`. Matches the depth bar in `specs/03-reservations/`.

## Purpose & scope
Model the sellable inventory — room categories, rooms, and their live status — and expose the status/blocking data that reservations (03) turn into availability.

**In scope:** RoomCategory CRUD (tariff, occupancy limits, HSN/SAC), Room CRUD, the room status lifecycle {Vacant, Occupied, Reserved, Under-Maintenance, Housekeeping} and its legal transitions, maintenance/housekeeping blocks that remove a room from availability.
**Out of scope:** availability computation & booking (03), rate plans/dynamic pricing (24), housekeeping task workflow (10 — this module exposes the status a HK update flips), floor CRUD (01).

## Dependencies
- **Tier 0:** 00-platform, 01-property-management (property + floors).
- **Consumed by:** 03-reservations (status + blocks → availability), 10-housekeeping, 11-maintenance, 14-analytics.

## Data owned
`RoomCategory`, `Room`, `RoomBlock` (all confirmed present in canonical `prisma/schema.prisma`). Reads: `Floor`, `Property`. `RoomBlock` (date-ranged out-of-order block) is owned here; `11.blockRoom` writes it via `02.blockRoom`, and `03` reads it for availability exclusion.

## Functional requirements (EARS)
- **FR-1 (ubiquitous):** The system shall let authorized users define `RoomCategory` per property with name, `baseRatePaise`, `maxAdults`, `maxChildren`, optional `hsnSac`.
- **FR-2 (ubiquitous):** The system shall let authorized users create `Room`s with a property-unique `number`, a category, and an optional floor.
- **FR-3 (unwanted):** If a room `number` is not unique within its property, then the system shall reject the save.
- **FR-4 (ubiquitous):** The system shall track each room's `status` ∈ {VACANT, OCCUPIED, RESERVED, UNDER_MAINTENANCE, HOUSEKEEPING}.
- **FR-5 (unwanted):** If a status transition is not legal (per the state machine in design), then the system shall reject it — e.g. a room cannot go OCCUPIED directly from UNDER_MAINTENANCE. Legal edges include the cancel/no-show resets `RESERVED→VACANT` and `OCCUPIED→VACANT` (role-gated), so `03` can return a room to inventory on cancellation/no-show (03 AC-12, AC-22).
- **FR-6 (event):** When a room's status changes, the system shall emit `RoomStatusChanged` (with from/to) and write an audit record.
- **FR-7 (ubiquitous):** The system shall let a room be blocked for a date range by writing a `RoomBlock(roomId, startDate, endDate, reason)` row (via `blockRoom`, called by `11.blockRoom`) so that `03` excludes any room with an overlapping `RoomBlock` from availability for those dates — independent of the room's current `status`.
- **FR-8 (state):** While a room `isActive=false`, the system shall exclude it from availability and new allocations but retain it in history.
- **FR-9 (ubiquitous):** The system shall present a room "board" per property showing every room with its live status and category, filterable by floor/category/status.
- **FR-10 (ubiquitous):** All reads/writes are property-scoped and authorized server-side.

## Non-functional (cited)
- Room board renders p95 < 1.5s for a 200-room property; status change reflects on other devices < 2s (`rules/non-functional-requirements.md`).
- Mobile-first board (tap a room → status/actions).

## Business rules referenced
`business-rules.md` §1–3 (availability inputs), §18 (status set + valid transitions), §20 (validate→authorize→transaction→event→audit).
