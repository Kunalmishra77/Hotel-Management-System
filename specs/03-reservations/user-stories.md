# 03 · Reservations — User Stories & Acceptance Criteria

Roles per `rules/user-roles.md`. Each AC is testable and maps to tests (`rules/testing-strategy.md`). ACs reference the shared **Test Fixtures** below so tests use identical, deterministic data.

## Test Fixtures (seeded for every test in this module)
| Ref | Entity | Value |
|---|---|---|
| PROP-A | Property | "Woodpecker MG Road", tz `Asia/Kolkata`, state `Karnataka`, GSTIN present |
| CAT-DLX | RoomCategory | "Deluxe", baseRate ₹4,000 (400000 paise), maxAdults 2, maxChildren 1 |
| CAT-STE | RoomCategory | "Suite", baseRate ₹7,000, maxAdults 3, maxChildren 2 |
| R-101 | Room | Deluxe, floor 1, status VACANT |
| R-102 | Room | Deluxe, floor 1, status VACANT |
| R-201 | Room | Suite, floor 2, status VACANT |
| R-103 | Room | Deluxe, with a `RoomBlock` 14–20 Jul (written via `11.blockRoom`→`02`); status UNDER_MAINTENANCE |
| R-104 | Room | Deluxe, status VACANT but with a `RoomBlock` 15–16 Jul (block-not-status exclusion case) |
| G-RAVI | Guest | "Ravi Kumar", mobile 98xxxxxx01, from Bangalore |
| G-MEHTA | Guest | "Anita Mehta", corporate = ACME |
| ACME | Corporate | "ACME Corp", GSTIN present, creditLimit ₹200,000 |
| USER-REC | User | role RECEPTION @ PROP-A |
| USER-HK | User | role HOUSEKEEPING @ PROP-A |
| CLOCK | Injected clock | fixed at 2026-07-12 10:00 IST |

## US-1 — Create a booking
*As Reception, I want to create a booking in a few taps, so that I can serve a guest quickly.*
- **AC-1:** Given R-101 free 12–15 Jul, when USER-REC books G-RAVI into R-101 for 12–15 Jul (2 adults), then a `Reservation` (CONFIRMED) + `RoomAllocation(R-101, 12–15 Jul)` exist and R-101 shows RESERVED.
- **AC-2:** Given rate ₹4,000/night, discount ₹500, extra bed ₹800, tax ₹1,110, 3 nights, when the form calculates, then total = 12,000 − 500 + 800 + 1,110 = **₹13,410** (1,341,000 paise); with ₹5,000 advance, balance = **₹8,410**. Stored in paise, shown in ₹.
- **AC-3:** When AC-1 saves, then `ReservationCreated` is emitted, an audit row written, and a confirmation message queued (direct source).
- **AC-4:** Given occupancy 3 adults into CAT-DLX (max 2) **without** extra bed, when submitted, then rejected per FR-17; with an extra-bed override, accepted.

## US-2 — Never double-book
*As a Manager, I want overbooking to be impossible.*
- **AC-5:** Given R-101 allocated 12–15 Jul, when anyone allocates R-101 for 14–16 Jul, then **rejected** with `ROOM_UNAVAILABLE`; no second allocation exists.
- **AC-6:** Given R-201 is the last free Suite, when two USER-REC sessions confirm it for overlapping dates **simultaneously**, then exactly **one** succeeds; the other gets `ROOM_UNAVAILABLE` (concurrency-safe via serializable txn + exclusion constraint).
- **AC-7:** Given R-103 has a `RoomBlock` 14–20 Jul, when searching Deluxe for 15–17 Jul, then R-103 is excluded; and given R-104 is VACANT but has a `RoomBlock` 15–16 Jul, it is **also excluded** for 15–17 Jul (availability = allocations + blocks, not status alone) — while R-104 is available again for 17 Jul onward (FR-2).
- **AC-8:** Adjacent, non-overlapping bookings are allowed: R-101 for 12–15 Jul and 15–17 Jul both succeed (checkout day is bookable — `[)` range).

## US-3 — Availability search
- **AC-9:** Given 12–15 Jul + Deluxe + 2 adults, when USER-REC searches, then only Deluxe rooms free the whole range meeting occupancy return; p95 < 500ms on the seeded 200-room dataset.
- **AC-10:** Given nothing free, when searching, then an empty result with a clear "no availability" state (HTTP 200, not an error).

## US-4 — Modify, cancel, group, hold
- **AC-11:** Given a CONFIRMED booking R-101 12–15 Jul, when moved to 16–18 Jul, then availability re-checked, allocation updated atomically, `ReservationModified` emitted; a conflict aborts with **no partial update**.
- **AC-12:** Given a CONFIRMED booking, when cancelled, then CANCELLED, allocations released (room bookable again), `ReservationCancelled` emitted.
- **AC-13 (group):** Given R-101 & R-102 free, when USER-REC books both for G-MEHTA 12–14 Jul in one request and R-102 becomes taken mid-transaction, then **neither** is allocated (all-or-nothing, FR-15).
- **AC-14 (hold):** Given an ENQUIRY hold on R-201 created at CLOCK with the property's `holdTtlHours` (24h) TTL, when the expiry job runs at CLOCK+25h, then the hold is released and R-201 is bookable; when it runs at CLOCK+1h, the hold still stands.
- **AC-26 (confirm hold):** Given the ENQUIRY hold on R-201, when USER-REC calls `confirmReservation` before expiry, then it becomes CONFIRMED, a `Folio` is ensured, `ReservationCreated` + audit are written, and the existing R-201 allocation is retained (no re-allocation) (FR-23).

## US-5 — Check-in / check-out / room move
- **AC-15:** Given a CONFIRMED booking for today, when USER-REC checks in, then IN_HOUSE, `checkInAt` set, room OCCUPIED, a `Folio` exists, `GuestCheckedIn` emitted.
- **AC-16:** Given IN_HOUSE with balance ₹8,410 unsettled, when USER-REC (no `folio:defer`) checks out, then **blocked**, balance shown.
- **AC-17:** Given balance settled (or deferred by a permitted user), when checking out, then CHECKED_OUT, `checkOutAt` set, room HOUSEKEEPING, `GuestCheckedOut` emitted.
- **AC-18:** Given a CANCELLED booking, when check-in attempted, then rejected (illegal transition, FR-11).
- **AC-19 (room move):** Given IN_HOUSE in R-101, when `reallocateRoom` moves it to R-102 (free), then allocation re-pointed atomically, R-101→HOUSEKEEPING, R-102→OCCUPIED, folio unchanged; when `toRoomId` is omitted, a free same-category room is auto-picked (23 FR-8). A target that is occupied/again-conflicting/blocked is rejected atomically.

## US-6 — Sources, attribution, no-show
- **AC-20:** Given an OTA reservation pushed by 13, when created, then it has the mapped `BookingSource` + `channelRef` and consumes availability identically to direct (FR-14).
- **AC-27 (OTA oversell):** Given an OTA push for a date/room-type with no free room (oversell) or a missing room-type mapping, when `createFromChannel` runs, then the reservation is still **ingested** (unallocated) and returned with `needsAttention: 'OVERSELL' | 'MAPPING_MISSING'` for reception to resolve — the paid booking is never dropped (FR-14).
- **AC-21:** Given a corporate booking for ACME, when attached, then it appears in source/corporate revenue reports (§7).
- **AC-22 (no-show):** Given a CONFIRMED booking for 11 Jul not checked in, when night audit runs `markNoShows(PROP-A, 11 Jul)`, then it becomes NO_SHOW, allocation released, the room reset RESERVED→VACANT (bookable again), and the no-show policy `Property.noShowRetainAdvance` applied (advance retained per config).

## Permission / negative
- **AC-23:** Given USER-HK, when calling any reservation create/modify/cancel action, then denied server-side (403) regardless of UI (FR-21).
- **AC-24:** Given check-out date ≤ check-in date, when submitted, then validation rejects with a field message; nothing persists (FR-22).
- **AC-25:** Given a discount ₹3,000 (above Reception's threshold) without `folio:discount`, when submitted, then rejected; with permission, accepted **and** an audited override row is written (FR-19).
