# 02 · Room Inventory — User Stories & Acceptance Criteria

Roles per `rules/user-roles.md`.

## Test Fixtures
| Ref | Entity | Value |
|---|---|---|
| PROP-A | Property | "Woodpecker MG Road", tz Asia/Kolkata |
| CAT-DLX | RoomCategory | "Deluxe", ₹4,000, maxAdults 2, maxChildren 1, HSN `996311` |
| CAT-STE | RoomCategory | "Suite", ₹7,000, maxAdults 3, maxChildren 2 |
| R-101 | Room | Deluxe, floor 1, VACANT |
| R-102 | Room | Deluxe, floor 1, OCCUPIED |
| R-201 | Room | Suite, floor 2, VACANT |
| USER-MGR | User | MANAGER @ PROP-A |
| USER-HK | User | HOUSEKEEPING @ PROP-A |

## US-1 — Define categories & rooms
*As a Manager, I want to set up categories and rooms, so that inventory exists to sell.*
- **AC-1:** Given USER-MGR, when creating CAT-DLX with rate ₹4,000 (400000 paise), max 2 adults/1 child, then it persists and is selectable when creating rooms.
- **AC-2:** Given CAT-DLX exists, when creating R-101 "101" on floor 1, then it persists with status VACANT.
- **AC-3:** Given R-101 "101" exists, when creating another room "101" in PROP-A, then rejected (FR-3).

## US-2 — Room status lifecycle
*As staff, I want room status to reflect reality, so that we never mis-sell or mis-clean.*
- **AC-4:** Given R-101 VACANT, when a reservation reserves it, then status → RESERVED and `RoomStatusChanged(VACANT→RESERVED)` emitted (FR-4/6).
- **AC-5:** Given R-101 RESERVED, when the guest checks in, then → OCCUPIED; on check-out → HOUSEKEEPING; when HK marks clean → VACANT.
- **AC-6:** Given R-101 UNDER_MAINTENANCE, when someone attempts OCCUPIED directly, then rejected as an illegal transition (FR-5).
- **AC-7:** Given USER-HK, when they flip R-102 OCCUPIED→HOUSEKEEPING is **not** their action but marking a vacated room clean is, then only permitted transitions for their role succeed (RBAC + state machine).

## US-3 — Maintenance block feeds availability
- **AC-8:** Given a `RoomBlock` on R-201 for 14–20 Jul (written via `11.blockRoom`→`02.blockRoom`), when 03 searches Suites for 15–17 Jul, then R-201 is excluded — even if its `status` is still VACANT, availability is driven by the block, not the status (FR-7).
- **AC-9:** Given R-201's block ends 20 Jul (or the `RoomBlock` is removed via `unblockRoom`), when searching for 21 Jul onward, then R-201 is available again.

## US-4 — Room board
- **AC-10:** Given PROP-A rooms, when USER-MGR opens the board, then all rooms show with live status + category; filtering by floor 1 shows R-101/R-102 only; p95 < 1.5s at 200 rooms.
- **AC-11:** Given the board is open, when R-101 status changes on another device, then this board updates within 2s (realtime).

## US-5 — Cancel / no-show returns a room to inventory
- **AC-14:** Given R-101 RESERVED (held by a booking) or R-102 OCCUPIED, when 03 cancels the booking / marks it no-show and calls `changeRoomStatus`, then `RESERVED→VACANT` (and, for a no-show already checked in or an OCCUPIED reset, `OCCUPIED→VACANT`) is accepted by `canTransition` and the room is bookable again (backs 03 AC-12/AC-22; FR-5).

## Permission / negative
- **AC-12:** Given USER-HK, when they attempt to create/delete a room or category, then denied server-side (403) (FR-10).
- **AC-13:** Given a deactivated room, when 03 computes availability, then it is excluded (FR-8).
