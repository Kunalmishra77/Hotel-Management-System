# 14 · Dashboard & Analytics — Design

## Schema slice (from canonical `prisma/schema.prisma`)
Owns `DailyStatSnapshot` (unique `(propertyId, businessDate)`, immutable) and `NightAuditRun` (unique `(propertyId, businessDate)`). Reads through owning modules' query layers only — posts nothing to folios.

**Schema notes:** `Property.currentBusinessDate` (rolled by night audit, FR-8) and `Property.nightAuditTime` (local schedule) are **confirmed present in the canonical schema**; `DailyStatSnapshot` fields (available/occupied room-nights, `roomRevenuePaise`/`totalRevenuePaise`, `expensePaise`, `adrPaise`, `revparPaise`, `occupancyBps`) are all present. **Segments are NOT snapshotted** — `DailyStatSnapshot` carries no segment rollup, so segmented views (FR-13) are **computed live** over the requested range from the owning query layers (06 revenue, 05 `GuestStatsSnapshot`, 25 `Corporate`/`TravelAgent`) with indexes + pagination; only per-`(property, date)` day metrics are immutable. The migration still materializes this slice, but nothing here is new to the canonical schema.

## Domain layer (pure — the canonical metric library) — `features/analytics/domain/`
Reused by 08. Per `reporting.md`:
- `occupancy(available, occupied): bps`
- `adr(roomRevenuePaise, occupiedRoomNights): paise`
- `revpar(roomRevenuePaise, availableRoomNights): paise`
- `availableRoomNights(sellableRooms, blocks, nights)` / `occupiedRoomNights(reservations)`
- `profit(revenuePaise, expensePaise): paise`
- `snapshotFrom(inputs): DailyStatSnapshot` — pure assembly for a business date.

## Application — server actions / jobs (`features/analytics`)
- `runNightAudit(propertyId, businessDate, {manual?})` — advisory-lock + unique guard; orchestrates (a) `06.postRoomCharges(propertyId, businessDate)` → (b) `03.markNoShows(propertyId, businessDate)` → (c) persist snapshot → (d) roll business date + lock → emit `NightAuditCompleted` + audit. Idempotent; on partial failure the `NightAuditRun` row is set `FAILED` (see re-run semantics below). (FR-5–10,16)
- `dashboardTiles(scope)` — live tiles for the open date, permission-filtered. (FR-2/14)
- Job registration: pg-boss schedule per property `nightAuditTime`.

## Queries (`features/analytics/queries.ts`)
- `liveTiles(propertyIds)` — indexed counts (rooms by status), today's arrivals/departures, revenue/expense today, pending balances (via 06/07 query layers).
- `trend(metric, range, propertyIds)` — snapshots for closed dates + live for open. 
- `segments(range, propertyIds)` — top corporates/agents/repeat guests by revenue + room-nights, **computed live** over the range (not read from a snapshot — see Schema notes) via 06/05/25 query layers, ranked + paginated.

## Realtime
Subscribes (via 00/17 SSE) to `RoomStatusChanged`, `ReservationCreated/Modified/Cancelled`, `GuestCheckedIn/Out`, `FolioCharged`, `PaymentReceived`, `ExpenseRecorded` → recompute only the affected tile → push to scoped subscribers < 2s. (FR-4)

## UI — wireframes (mobile-first, `features/analytics/components/`)
**Dashboard (phone, consolidated):**
```
┌───────────────────────────┐
│ Today · All properties ▾  │
│ ┌─────────┐ ┌───────────┐ │
│ │Check-in │ │Check-out  │ │
│ │ 3 / 5   │ │ 2 / 2     │ │
│ └─────────┘ └───────────┘ │
│ ┌─────────┐ ┌───────────┐ │
│ │Occupancy│ │Revenue    │ │
│ │  66%    │ │ ₹24,000   │ │  ← financial tiles hidden
│ └─────────┘ └───────────┘ │     without report:view-financial
│ Pending ₹8,410 · Adv 4    │
│ [Trends] [Segments]       │
│ Night audit: PROP-A ✓ 12Jul│
└───────────────────────────┘
```
Tiles animate on realtime update. Trends = line charts (occupancy/revenue); Segments = ranked lists. Manual "Run night audit" behind permission with a confirm.

## Events
Emits: `NightAuditCompleted`, `PaymentDueDetected` (also emitted by 06; deduped by consumers). Consumes: the tile-affecting events above. Catalog: `docs/architecture/domain-events.md`.

## Sequences
**Night audit:** acquire advisory lock (propertyId,date) → **upsert the `NightAuditRun(propertyId, businessDate)` row to `RUNNING`** (the run row is keyed by the same unique `(propertyId, businessDate)`, so a re-run **updates/resets the existing row rather than inserting a second** — the unique constraint would otherwise block a 2nd insert) → check no snapshot → `06.postRoomCharges(propertyId, businessDate)` → `03.markNoShows(propertyId, businessDate)` → build snapshot → INSERT DailyStatSnapshot → roll `currentBusinessDate` + lock → mark run `COMPLETED`, emit `NightAuditCompleted` + audit → release lock. Failure → set the existing run row `FAILED`, no event, date unchanged; a re-run resets that same row `RUNNING` (upsert/reset, never a duplicate insert) and every downstream call is idempotent.

## Error catalog
`AUDIT_ALREADY_RUN`, `AUDIT_IN_PROGRESS`, `AUDIT_FAILED`, `FORBIDDEN`, `CLOSED_DATE`.

## Edge cases
- Property with 0 sellable rooms → occupancy defined as 0, no divide-by-zero.
- DST day → nights/available computed via property tz.
- Late event after tile computed → recompute is idempotent (reads current state).
- Manual audit before scheduled time → allowed with permission; scheduled job then no-ops (already closed).
- Consolidated view mixing an open and a closed property → open contributes live, closed contributes snapshot (FR-15).
