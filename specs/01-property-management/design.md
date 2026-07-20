# 01 · Property Management — Design

## Schema slice (from canonical `prisma/schema.prisma`)
Owns `Property`, `Floor`. `Property` already carries org, code (`@@unique([orgId, code])`), address, timezone, gstin, owner, `isActive`, `deletedAt`. `Floor` unique by `(propertyId, name)`. Occupancy is **derived** from `Room.status` (owned by 02) — not stored on `Property`.

## Domain layer (pure) — `features/properties/domain/`
- `validateGstin(gstin): boolean` — 15-char state-code + PAN + entity + checksum pattern.
- `occupancyRollup(rooms): { total, vacant, occupied, reserved, maintenance, housekeeping, occupancyBps }` — status counts + **live current-status occupancy** in basis points = `OCCUPIED ÷ (active rooms − UNDER_MAINTENANCE)` (`rules/reporting.md`). This is the point-in-time status figure for the overview tile, **not** 14's room-night ADR/RevPAR denominator; `RESERVED` is not counted as occupied here.

## Application — server actions (`features/properties/actions.ts`)
Per `rules/api-conventions.md`: zod → authorize → transaction → event + audit → `Result`.
- `createProperty(input)` / `updateProperty(id, input)` — `property:manage` (Admin). Validate code uniqueness + GSTIN. Emit `PropertyCreated`/`PropertyUpdated`.
- `deactivateProperty(id)` — soft-delete (`isActive=false`, `deletedAt`), retains history; emits `PropertyDeactivated` (FR-5/9).
- `addFloor(propertyId, name, sortOrder)` / `reorderFloors(...)` — `property:manage`.

## Queries (`features/properties/queries.ts`)
- `listProperties()` — property-scoped to the user's assignments (Admin = all).
- `getProperty(id)`.
- `propertyOverview()` — for each accessible property, join room counts by status → occupancy rollup. Backed by an indexed `Room(propertyId, status)` count query; cached briefly and invalidated on `RoomStatusChanged`.

## Realtime
Subscribes to `RoomStatusChanged` via LISTEN/NOTIFY→SSE (17); pushes updated occupancy tiles to open overviews (FR-7, AC-7).

## UI — wireframes (mobile-first, `features/properties/components/`)

**Multi-property overview** (phone):
```
┌───────────────────────────┐
│ Properties          + Add │
│ ┌───────────────────────┐ │
│ │ Woodpecker MG Road WMG│ │
│ │ ▉▉▉░░░░░░░  33% occ*   │ │
│ │ 10 rms · 6 vac · 3 occ│ │
│ │ 1 maint               │ │
│ └───────────────────────┘ │
│ ┌───────────────────────┐ │
│ │ Woodpecker Whitefield │ │
│ │ ▉▉▉▉▉▉░░░░  60% occ    │ │
│ └───────────────────────┘ │
└───────────────────────────┘
```
The tile's "% occ" is **live current-status occupancy** (see `occupancyRollup`), not the ADR/RevPAR denominator. Tile occupancy bar animates on realtime update. Tap → property detail (floors, rooms via 02).

**Property form** — grouped: Identity (name, code) · Address · Tax (GSTIN) · Owner · Timezone. Inline validation; code/GSTIN checked on blur.

## Events
Emits: `PropertyCreated`, `PropertyUpdated`, `PropertyDeactivated`. Consumes: `RoomStatusChanged` (for live occupancy). Catalog: `docs/architecture/domain-events.md`.

## Sequences
**Live overview:** open → `propertyOverview()` initial render → subscribe SSE → on `RoomStatusChanged` recompute the affected property tile only.

## Error catalog
`CODE_IN_USE`, `INVALID_GSTIN`, `VALIDATION_FAILED`, `FORBIDDEN`, `FLOOR_DUPLICATE`.

## Edge cases
- Deactivating a property with in-house guests → block with a clear message (must be zero in-house first).
- Timezone change on a live property → applies to future business-date math only; historical snapshots unaffected.
- Very large property (1000 rooms) → overview count query stays indexed; no per-room fetch.
