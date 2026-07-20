# 03 · Reservations — Requirements

> Exemplar spec (depth bar for all modules). Source: client doc §2. Read with `.claude/rules/business-rules.md` (availability, folio), `rules/reporting.md`, `rules/non-functional-requirements.md`, `prisma/schema.prisma`.

## Purpose & scope
Record, price, and manage bookings from all sources; guarantee no overbooking; create the folio that billing (06) settles. Owns the reservation lifecycle and room allocation (the availability truth).

**In scope:** enquiry→confirmed→in-house→checked-out (+cancel/no-show), tentative holds, single & group (multi-room) bookings, room allocation, rate/discount/extra-bed/tax/other/advance capture, auto bill preview, availability search, all booking sources (incl. OTA records created by 13), source/corporate/agent attribution.
**Out of scope:** folio ledger math & GST invoice (06), OTA sync mechanics (13), public web booking (23), dynamic rate computation (24 — this module consumes a resolved rate).

## Dependencies
- **Tier 0:** 00-platform (auth, tenancy, events, audit), 01-property-management, 02-room-inventory.
- **Tier 1 peer:** 04-guest-crm.
- **Downstream consumers:** 06-billing, 14-analytics, 12-communications, 13-channels.

## Data owned
`Reservation`, `RoomAllocation` (+ derived hold expiry). Reads: `Room`, `RoomCategory`, `RoomBlock` (owned by 02 — availability exclusion), `Guest`, `RatePlan`/`DynamicRate`, `Corporate`, `TravelAgent`. On confirm, calls `billing.ensureFolio()` to create the `Folio` (owned by 06). Config it reads from `Property` (`dayUseEnabled`, `holdTtlHours`, `noShowRetainAdvance`) and `SecuritySettings` (`discountThresholdPaise`).

## Functional requirements (EARS)
- **FR-1 (ubiquitous):** Represent every booking as a `Reservation` scoped to one property with a unique human `code`.
- **FR-2 (event):** When availability is requested for a date range, category, and occupancy, return only rooms with no overlapping `RoomAllocation`/hold, **no overlapping `RoomBlock`** (owned by 02, written via `11.blockRoom`), and no blocking room status, for that range. Availability = allocations + blocks (`docs/architecture/database-setup.md`), not room status alone.
- **FR-3 (event):** When a reservation is confirmed, create exactly one `RoomAllocation` per room-range, persisted in the same transaction that (re-)checks availability — that check must exclude both overlapping `RoomAllocation`s and overlapping `RoomBlock`s.
- **FR-4 (unwanted):** If a confirm/allocate would overlap an existing allocation **or an existing `RoomBlock`** for the same room, reject it atomically — overbooking (and booking over a maintenance block) must be impossible. The DB exclusion constraint covers allocations; the serializable booking tx additionally checks `RoomBlock` (`database-setup.md` → "No booking over a block").
- **FR-5 (ubiquitous):** Record source, adults, children, check-in/out dates; compute `nights` in property-local days (min 1). Client §2's "Check-in Date & Time" is captured as the booked `checkInDate` (`@db.Date`) **plus the optional `expectedArrival`** (planned check-in time / ETA at booking, e.g. "18:00", "late evening"); the actual `checkInAt`/`checkOutAt` timestamps are stamped at check-in/out.
- **FR-6 (ubiquitous):** Capture `ratePaise, discountPaise, extraBedPaise, taxPaise, otherChargesPaise, advancePaise`; present bill preview `total = rate×nights − discount + extraBed + otherCharges + tax`, `balance = total − advance`.
- **FR-7 (event):** When confirmed, emit `ReservationCreated`, write audit, and (direct source) trigger confirmation via 12.
- **FR-8 (state):** While `CONFIRMED`, allow modify/cancel, each re-validating availability and re-emitting the right event.
- **FR-9 (event):** When check-in is performed, set `IN_HOUSE`, stamp `checkInAt`, set room(s) `OCCUPIED`, ensure a `Folio`, emit `GuestCheckedIn`.
- **FR-10 (event):** When check-out is performed, require folio balance settled or explicitly deferred (permission `folio:defer`), set `CHECKED_OUT`, stamp `checkOutAt`, set room(s) `HOUSEKEEPING`, emit `GuestCheckedOut`.
- **FR-11 (unwanted):** If an illegal status transition is requested, reject it (state machine in design).
- **FR-12 (state):** While `CANCELLED`/`NO_SHOW`, release allocations so inventory is bookable again.
- **FR-13 (ubiquitous):** Support corporate/travel-agent attribution for revenue segmentation (§7, module 25).
- **FR-14 (event):** When 13 pushes an OTA reservation (`createFromChannel`), create a `Reservation` with mapped source + `channelRef`, consuming the same availability as direct. If no room is free (oversell) or the room-type mapping is missing, still **ingest** the reservation unallocated and flag it `needsAttention: 'OVERSELL' | 'MAPPING_MISSING'` for reception to resolve — never drop a paid OTA booking.
- **FR-15 (event):** When a group (multi-room) booking is confirmed, allocate all rooms atomically — all succeed or none (no partial group).
- **FR-16 (state):** While a reservation is a tentative `ENQUIRY` hold, reserve inventory for the property's configured TTL `Property.holdTtlHours` (default 24h); on expiry the hold is auto-released by a scheduled job.
- **FR-17 (unwanted):** If occupancy (adults+children) exceeds the room category's `maxAdults/maxChildren`, reject unless an extra-bed override is applied.
- **FR-18 (event):** When night audit runs (14) via `markNoShows(propertyId, businessDate)`, mark `CONFIRMED` reservations whose check-in date has passed without check-in as `NO_SHOW`, release their allocations (rooms → VACANT), and apply the no-show policy `Property.noShowRetainAdvance` (retain vs release advance).
- **FR-19 (unwanted):** If a rate below the category floor or a discount above the threshold `SecuritySettings.discountThresholdPaise` is entered, require permission `folio:discount` and write an audited override; otherwise reject.
- **FR-20 (state):** While `IN_HOUSE` (or, for 23, when reassigning an equivalent room), allow `reallocateRoom(reservationId, toRoomId?)` — re-allocate to a different room atomically, preserving the folio; when `toRoomId` is omitted, auto-pick a free room in the same category (23 FR-8).
- **FR-21 (ubiquitous):** Every reservation mutation is property-scoped, authorized server-side, audited, and emits its domain event (`business-rules.md` §20).
- **FR-22 (unwanted):** If check-out date ≤ check-in date when `Property.dayUseEnabled` is false, or dates are in the past for a new booking, reject at validation; nothing persists. When `Property.dayUseEnabled` is true, `checkIn == checkOut` is allowed (nights = 1).
- **FR-23 (event):** When a tentative `ENQUIRY` hold is confirmed via `confirmReservation(reservationId)`, promote it `ENQUIRY→CONFIRMED`, ensure a `Folio` (`billing.ensureFolio`), emit `ReservationCreated`/audit, and keep the existing allocation (no re-allocation) — the hold's reserved inventory carries straight into the confirmed booking.

## Non-functional (cited)
Availability search p95 < 500ms; create/confirm p95 < 800ms; no overbooking under concurrency; booking completable in a few taps on a phone. (`rules/non-functional-requirements.md`)

## Business rules referenced
`business-rules.md` §1–4 (availability/nights), §5 (folio per in-house reservation), §18–19 (transitions), §20 (validate→authorize→transaction→event→audit).
