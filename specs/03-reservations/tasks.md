# 03 · Reservations — Tasks

Ordered, small, test-first for domain. Each ends at `rules/definition-of-done.md`. `(AC-n)/(FR-n)` = traceability. Tests use the **Test Fixtures** in `user-stories.md`.

## Schema & migration
- [ ] T-1 Confirm `Reservation`/`RoomAllocation` slice + `holdExpiresAt`; write migration. (FR-1,3,16)
- [ ] T-2 Add `btree_gist` + `room_no_overlap` exclusion constraint via raw SQL; reversible down. (FR-4, AC-5/6/8) The constraint covers `RoomAllocation` only; overlapping-`RoomBlock` rejection is enforced app-level in the serializable booking tx (`database-setup.md` → "No booking over a block").
- [ ] T-3 Indexes: `RoomAllocation(roomId,startDate,endDate)`, `RoomBlock(roomId,startDate,endDate)` (read for availability), `Reservation(propertyId,status)`, `(propertyId,checkInDate)`, `(guestId)`. (NFR)
- [ ] T-4 Seed fixtures (PROP-A, categories, rooms incl. R-103 maintenance, guests, ACME, users) for tests.

## Domain (write tests first)
- [ ] T-5 `nights()` incl. tz, min-1, DST. (FR-5, AC-2)
- [ ] T-6 `priceReservation()` Decimal → total/balance/breakdown = ₹13,410/₹8,410. (FR-6, AC-2)
- [ ] T-7 `canTransition()` full state machine incl. illegal edges. (FR-11, AC-18)
- [ ] T-8 `overlaps()` `[)` semantics (adjacent allowed). (FR-2, AC-8)
- [ ] T-9 `validateOccupancy()` max + extra-bed override. (FR-17, AC-4)
- [ ] T-10 `checkRateFloor()` discount threshold (`SecuritySettings.discountThresholdPaise`) / floor (`RoomCategory.floorPaise`) + `folio:discount` permission. (FR-19, AC-25)

## Application (integration tests vs test DB)
- [ ] T-11 `searchAvailability()` excludes overlapping allocations/holds, **overlapping `RoomBlock`s (02-owned)**, and blocking status; test a room VACANT-but-blocked is excluded; p95 budget test on 200-room seed. (FR-2, AC-7/9/10)
- [ ] T-12 `createReservation()` SERIALIZABLE txn re-checking allocations **and blocks** + folio + event + audit; a booking over an overlapping `RoomBlock` is rejected. (FR-3/4/6/7, AC-1/2/3/7)
- [ ] T-13 Concurrency: two simultaneous confirms of R-201 → exactly one wins. (FR-4, AC-6)
- [ ] T-14 `holdReservation()` (TTL from `Property.holdTtlHours`) + expiry job idempotent release. (FR-16, AC-14)
- [ ] T-14b `confirmReservation()` promotes hold ENQUIRY→CONFIRMED, calls `ensureFolio`, emits `ReservationCreated` + audit, keeps existing allocation. (FR-23, AC-26)
- [ ] T-15 Group booking all-or-nothing. (FR-15, AC-13)
- [ ] T-16 `modifyReservation()` atomic re-allocation; conflict aborts cleanly. (FR-8, AC-11)
- [ ] T-17 `cancelReservation()` releases allocations + event. (FR-12, AC-12)
- [ ] T-18 `reallocateRoom()` atomic; folio preserved; room statuses flipped; re-check excludes allocations + blocks; `toRoomId` omitted → auto-pick same-category free room (23 FR-8). (FR-20, AC-19)
- [ ] T-19 `checkIn()` transitions + room status + folio ensure + event. (FR-9, AC-15)
- [ ] T-20 `checkOut()` balance gate (+`folio:defer`) + transitions + event. (FR-10, AC-16/17)
- [ ] T-21 `markNoShows(propertyId, businessDate)` at night audit: NO_SHOW + release allocations (rooms → VACANT) + policy `Property.noShowRetainAdvance`. (FR-18, AC-22)
- [ ] T-22 `createFromChannel()` maps source+channelRef, same availability; oversell / missing mapping → ingest unallocated with `needsAttention`, never dropped. (FR-14, AC-20/AC-27)
- [ ] T-23 Corporate/agent attribution persisted + reportable. (FR-13, AC-21)
- [ ] T-24 RBAC denials for USER-HK on every action. (FR-21, AC-23)
- [ ] T-25 Validation: checkout≤checkin (unless `Property.dayUseEnabled`) / past date rejected, nothing persists. (FR-22, AC-24)
- [ ] T-26 Error catalog codes surfaced correctly; internal detail logged not leaked.

## Queries & UI (mobile-first)
- [ ] T-27 Queries: list/get/arrivals-departures/calendar, scoped + paginated.
- [ ] T-28 Booking stepper (4 steps) with live bill preview + numeric keypads + 44px targets. (AC-1/2/4)
- [ ] T-29 Reservation board (cards on phone, status columns on tablet) with filters.
- [ ] T-30 Check-in / check-out bottom sheets; balance gate visible. (AC-15/16/17)
- [ ] T-31 Optimistic status updates reconciled with server.

## E2E (Playwright, mobile viewport)
- [ ] T-32 Journey: login → search → book → check-in → settle → check-out. (AC-1/9/15/17)

## Done
- [ ] T-33 `/review-module` clean; every AC mapped to a green test; DoD satisfied.
