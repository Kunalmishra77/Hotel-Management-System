# 03 · Reservations — Design

## Schema slice (from canonical `prisma/schema.prisma`)
Owns `Reservation`, `RoomAllocation`. Overbooking is prevented at the **database** with a PostgreSQL exclusion constraint on `RoomAllocation(roomId, daterange)` using `btree_gist` (Prisma can't express it; added via raw SQL in this module's migration):

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE "RoomAllocation"
  ADD CONSTRAINT room_no_overlap
  EXCLUDE USING gist ("roomId" WITH =, daterange("startDate","endDate",'[)') WITH &&);
```
`'[)'` = inclusive start, exclusive end → checkout day is bookable (AC-8). This makes FR-4/AC-5/AC-6 true *by construction*: a race that passes the app check still fails the DB insert and rolls back. Hold rows use the same table with a `holdExpiresAt` (nullable) so holds consume inventory too (FR-16).

**Availability = allocations + blocks.** The exclusion constraint only covers `RoomAllocation`. Date-ranged maintenance lives in `RoomBlock` (owned by 02, written via `11.blockRoom`→`02.blockRoom`) — read-only here. Both `searchAvailability` and the serializable booking tx must exclude rooms with an overlapping `RoomBlock` **and** an overlapping `RoomAllocation` (`docs/architecture/database-setup.md` → "Availability = allocations + blocks" / "No booking over a block"), never room `status` alone.

## State machine (FR-11)
```
           ┌─────────┐  confirm   ┌──────────┐  check-in  ┌──────────┐  check-out ┌────────────┐
  create ─►│ ENQUIRY │──────────► │ CONFIRMED│──────────► │ IN_HOUSE │──────────► │ CHECKED_OUT│
           └────┬────┘            └────┬─────┘            └────┬─────┘            └────────────┘
        expire/ │            cancel│   │ night-audit no-show   │ room-move (self)
         cancel ▼                  ▼   ▼                       ▼
                └──────────► CANCELLED / NO_SHOW ◄─────────────┘
```
`canTransition(from,to)` is the single authority; any edge not drawn is rejected.

## Domain layer (pure, unit-tested) — `features/reservations/domain/`
- `nights(checkIn, checkOut, tz): number` — property-local days, min 1, DST-safe.
- `priceReservation(input): BillPreview` — Decimal.js → `{ totalPaise, balancePaise, breakdown }` (FR-6/AC-2).
- `canTransition(from, to): boolean` — the state machine above.
- `overlaps(a, b): boolean` — `[)` range overlap for the in-app pre-check.
- `validateOccupancy(cat, adults, children, extraBed): Result` — FR-17/AC-4.
- `checkRateFloor(cat, ratePaise, discountPaise, perms): Result` — floor = `RoomCategory.floorPaise`; discount threshold = `SecuritySettings.discountThresholdPaise`; above threshold / below floor requires `folio:discount` + audited override. FR-19/AC-25.

## Application — server actions (`features/reservations/actions.ts`)
Per `rules/api-conventions.md`: zod → authorize(property scope) → transaction → event+audit → `Result`.
- `searchAvailability(input)` — `NOT EXISTS` vs `RoomAllocation` (incl. live holds) **and `NOT EXISTS` vs overlapping `RoomBlock`** (02-owned; written by `11.blockRoom`) + status filter; indexes `RoomAllocation(roomId,startDate,endDate)`, `RoomBlock(roomId,startDate,endDate)`, `Room(propertyId,status)`. (FR-2)
- `createReservation(input)` — `reservation:create`. SERIALIZABLE txn: re-check availability (allocations **and** blocks) → insert `Reservation` + `RoomAllocation`(s) (group = all in one txn, FR-15) → set rooms RESERVED → `billing.ensureFolio` on confirm → emit `ReservationCreated` → audit. The candidate rooms are also checked against `RoomBlock` under the same lock (`SELECT … FOR UPDATE`) since the exclusion constraint covers only allocations. Retry-once on serialization failure, else `ROOM_UNAVAILABLE`.
- `holdReservation(input)` — creates ENQUIRY + allocation with `holdExpiresAt` = now + `Property.holdTtlHours` (FR-16).
- `confirmReservation(reservationId)` — `reservation:create`. Promotes a hold `ENQUIRY→CONFIRMED`, calls `billing.ensureFolio`, emits `ReservationCreated` + audit; keeps the existing allocation (no re-check needed — inventory was already held). (FR-23)
- `modifyReservation(id, changes)` / `cancelReservation(id, reason)` (🔒) / `reallocateRoom(reservationId, toRoomId?)` — atomic re-allocation + events; `cancelReservation` releases allocations and resets rooms → VACANT (via 02 `changeRoomStatus`). `reallocateRoom` moves an `IN_HOUSE` guest or (for 23 FR-8) reassigns an equivalent room; `toRoomId` omitted → auto-pick a free room in the same category. Both re-checks exclude blocks + allocations. (FR-8/12/20)
- `checkIn(id)` / `checkOut(id,{defer?})` — transitions + room-status effects + folio existence/settlement (FR-9/10).
- Called by 13: `createFromChannel(payload)` maps source+channelRef and **ingests even when no room is free** — on oversell / missing room-type mapping it persists the reservation unallocated and returns `needsAttention: 'OVERSELL' | 'MAPPING_MISSING'` (never drops a paid OTA booking) (FR-14). Called by 14: `markNoShows(propertyId, businessDate)` (FR-18).

Concurrency: booking path SERIALIZABLE (or `SELECT … FOR UPDATE` on candidate rooms **and their `RoomBlock` rows**) + exclusion constraint backstop for allocations.

## Queries (`features/reservations/queries.ts`)
`listReservations(filter)`, `getReservation(id)`, `arrivalsDepartures(date)`, `reservationCalendar(range)` — property-scoped, cursor-paginated.

## UI — wireframes (mobile-first, `features/reservations/components/`)

**Booking stepper** (phone, 375px):
```
┌───────────────────────────┐   ┌───────────────────────────┐
│ ‹ New Booking      ● ○ ○ ○ │   │ ‹ New Booking      ○ ● ○ ○ │
│                           │   │  Deluxe · 12–15 Jul · 2ad │
│  Check-in   [12 Jul 2026] │   │ ┌───────────────────────┐ │
│  Check-out  [15 Jul 2026] │   │ │ R-101  Deluxe  ✓ free │ │
│  Nights      3            │   │ │ R-102  Deluxe  ✓ free │ │
│  Adults [2] Children [0]  │   │ │ R-103  Deluxe  ✗ maint│ │
│  Category  [Deluxe   ▾]   │   │ └───────────────────────┘ │
│                           │   │  (tap to select a room)   │
│      [ Check availability]│   │              [ Continue ] │
└───────────────────────────┘   └───────────────────────────┘
┌───────────────────────────┐   ┌───────────────────────────┐
│ ‹ New Booking      ○ ○ ● ○ │   │ ‹ Review           ○ ○ ○ ● │
│  Guest                    │   │  Ravi Kumar · R-101       │
│  [🔍 search mobile/name ] │   │  12–15 Jul · 3 nights     │
│  ▸ Ravi Kumar 98xxxx01    │   │  Room     4,000 × 3 12,000│
│  ▸ + New guest            │   │  Discount        −   500  │
│  Rate/night [₹4000]       │   │  Extra bed       +   800  │
│  Discount   [₹500]        │   │  Tax             + 1,110  │
│  Extra bed  [₹800]        │   │  ─────────────────────────│
│  Advance    [₹5000]       │   │  Total          ₹13,410   │
│              [ Continue ] │   │  Advance        − 5,000   │
│                           │   │  Balance due    ₹ 8,410   │
│                           │   │        [ Confirm booking ]│
└───────────────────────────┘   └───────────────────────────┘
```
Numeric keypads (`inputmode=numeric`) for amounts; live preview recomputes on each change; primary action ≥44px, thumb-reachable.

**Reservation board** (phone = cards, tablet+ = columns by status):
```
┌───────────────────────────┐
│ Reservations   [filters ▾]│
│ Arrivals today (3)        │
│ ┌───────────────────────┐ │
│ │ Ravi Kumar   R-101    │ │
│ │ 12–15 Jul  ₹8,410 due │ │
│ │ CONFIRMED  [Check-in] │ │
│ └───────────────────────┘ │
│ In-house (12) ▸           │
│ Departures today (2) ▸    │
└───────────────────────────┘
```

**Check-out sheet** (bottom sheet): shows balance; if unsettled and no `folio:defer` → Check-out disabled with "Settle ₹8,410 first"; else confirm.

Optimistic status updates reconciled with server (`rules/mobile-first.md`).

## Events
Emits: `ReservationCreated/Modified/Cancelled`, `GuestCheckedIn`, `GuestCheckedOut`, (via 14) `NoShowMarked`. Consumes: `ChannelReservationPulled` (13). Catalog: `docs/architecture/domain-events.md`.

## Sequences
**Confirm booking:** validate+authorize → BEGIN SERIALIZABLE → re-check availability (no overlapping `RoomAllocation` **and** no overlapping `RoomBlock`) → INSERT Reservation → INSERT RoomAllocation(s) [exclusion constraint] → rooms RESERVED → `billing.ensureFolio` → INSERT DomainEvent+AuditLog → COMMIT → worker: 12 confirmation, 14 pace. On serialization/constraint error (incl. a block overlap) → ROLLBACK → retry once → else `{ok:false,error:'ROOM_UNAVAILABLE'}`.

**Check-out:** verify balance (block unless settled or `folio:defer`) → CHECKED_OUT + room HOUSEKEEPING → emit `GuestCheckedOut` → 12 sends thank-you/review/invoice.

## Error catalog (user-safe codes)
`ROOM_UNAVAILABLE`, `ILLEGAL_TRANSITION`, `OCCUPANCY_EXCEEDED`, `RATE_BELOW_FLOOR`, `BALANCE_UNSETTLED`, `VALIDATION_FAILED`, `FORBIDDEN`. Internal detail logged with request id; only the code + message reach the client.

## Edge cases & failure handling
- Day-use (checkIn==checkOut): nights=1 if `Property.dayUseEnabled`, else `VALIDATION_FAILED`.
- Group booking: all allocations in one txn; any conflict → whole group fails (AC-13).
- Hold expiry job idempotent (TTL from `Property.holdTtlHours`); a hold promoted to CONFIRMED via `confirmReservation` before expiry is untouched.
- Modify shortening a stay after partial charges: allocation changes; folio untouched (06 owns money).
- OTA double-push (same `channelRef`): deduped by 13's inbox before this module is called. An oversell/unmapped push is ingested unallocated with `needsAttention` (FR-14), not rejected.
- `reallocateRoom` to an occupied/again-conflicting/blocked room: rejected atomically, original allocation intact; `toRoomId` omitted → auto-pick a free same-category room (23 FR-8).
- DST / timezone: all date math via property tz; nights correct across a DST boundary.
- Past-dated new booking: rejected (FR-22) except when 13 back-fills a channel record (flagged).
