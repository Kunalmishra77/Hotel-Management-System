# 02 · Room Inventory — Design

## Schema slice (from canonical `prisma/schema.prisma`)
Owns `RoomCategory` (`@@unique([propertyId, name])`), `Room` (`@@unique([propertyId, number])`, `@@index([propertyId, status])`), and `RoomBlock` (`@@index([roomId, startDate, endDate])`). `RoomStatus` enum defined in schema.

**Schema notes — `RoomBlock` is confirmed present in the canonical schema** (`RoomBlock(id, propertyId, roomId, startDate @db.Date, endDate @db.Date, reason, maintenanceJobId?)`). It is the single home for *date-ranged* out-of-order maintenance — **not** overloaded room status and **not** a `RoomAllocation`: **02 owns the table**, `11.blockRoom` writes it (through `02.blockRoom`), and `03` reads it for availability exclusion (`docs/architecture/database-setup.md` → "Availability = allocations + blocks"). The room's live `UNDER_MAINTENANCE` status and a `RoomBlock` are complementary: status drives the board colour, the block drives date-ranged availability.

## State machine (FR-5)
```
        reserve            check-in           check-out          cleaned
VACANT ──────────► RESERVED ───────► OCCUPIED ─────────► HOUSEKEEPING ──────► VACANT
   │  ▲               │                 │  ▲                   │
   │  │ cancel/no-show│ cancel/no-show  │  │ walk-in occupy    │
   │  └───────────────┴─────────────────┘  └── VACANT ─────────┘
   │
   └──── block ──► UNDER_MAINTENANCE ──── end-block ──► VACANT
```
`canTransition(from, to, role)` is the single authority; illegal edges rejected (AC-6). Cancel- and no-show-driven resets **`RESERVED→VACANT`** and **`OCCUPIED→VACANT`** are legal edges, invoked by `03` when it releases allocations on `cancelReservation`/`markNoShows` (03 AC-12, AC-22) — `canTransition` must allow them. Some transitions are role-gated (HK can `HOUSEKEEPING→VACANT`; Reception drives `RESERVED`/`OCCUPIED` and the cancel/no-show resets via 03; `UNDER_MAINTENANCE` is Maintenance-gated).

## Domain layer (pure) — `features/rooms/domain/`
- `canTransition(from, to): boolean` — the state machine.
- `filterAvailableStatuses(rooms): Room[]` — VACANT/RESERVED-not-blocking helpers for 03.

## Application — server actions (`features/rooms/actions.ts`)
Per `api-conventions.md`: zod → authorize → transaction → event + audit.
- `createCategory/updateCategory` — `room:manage`. HSN/SAC, rate in paise, occupancy limits. `createCategory` emits `CategoryCreated`.
- `createRoom/updateRoom/deactivateRoom` — `room:manage`. Number uniqueness (FR-3). `createRoom` emits `RoomCreated`.
- `changeRoomStatus(roomId, to)` — validates `canTransition` + role; emits `RoomStatusChanged`. Called internally by 03 (reserve/checkin/checkout, **and the `RESERVED→VACANT`/`OCCUPIED→VACANT` reset on cancel/no-show**), 10 (cleaned), and 11 (maintenance).
- `blockRoom(roomId, range, reason, jobId?)` / `unblockRoom(blockId)` — `maintenance:manage`; **writes / removes a `RoomBlock` row** (02-owned) so `03` availability excludes the date range (FR-7). `11.blockRoom` calls this; `03` reads the blocks. Blocking does not itself change room `status`.

## Queries (`features/rooms/queries.ts`)
`roomBoard(propertyId, filter)` — indexed `(propertyId,status)`; returns rooms + category + status; cursor-paginated for very large properties. `listCategories(propertyId)`.

## Realtime
Emits `RoomStatusChanged` → LISTEN/NOTIFY→SSE (17) updates room boards and the property overview (01) live (AC-11).

## UI — wireframes (mobile-first, `features/rooms/components/`)

**Room board** (phone = grid of chips, color by status):
```
┌───────────────────────────┐
│ Rooms · MG Road  [flr ▾]  │
│ [All][Vac][Occ][Resv][Mnt]│
│  101🟢 102🔴 103🟡 104🟢   │
│  201🟢 202🟠 203🔴 204🟢   │
│  🟢Vacant 🔴Occ 🟡Resv     │
│  🟠HK 🟣Maint             │
│  (tap a room → actions)   │
└───────────────────────────┘
```
Tap R-101 → bottom sheet with allowed status actions for the user's role + "block for maintenance".

**Category form** — name, rate (₹, numeric keypad), max adults/children, HSN/SAC.

## Events
Emits: `RoomStatusChanged`, `RoomCreated`, `CategoryCreated`. Consumes: none directly (status changes arrive as action calls from 03/10/11). Catalog: `docs/architecture/domain-events.md`.

## Error catalog
`ROOM_NUMBER_IN_USE`, `ILLEGAL_TRANSITION`, `FORBIDDEN`, `VALIDATION_FAILED`.

## Edge cases
- Changing a category's rate does not retro-change existing reservations (they snapshot their rate at booking — 03/06).
- Deactivating a room with a future reservation → block until reservations are moved/cancelled.
- Concurrent status changes to the same room → last transaction wins; both audited; illegal resulting transitions rejected.
- Bulk room creation (e.g. 50 rooms on a floor) → batched, each number validated.
