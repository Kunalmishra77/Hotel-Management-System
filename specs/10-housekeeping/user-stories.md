# 10 · Housekeeping — User Stories & Acceptance Criteria

Roles per `rules/user-roles.md`. Mobile + offline is the point.

## Test Fixtures
| Ref | Entity | Value |
|---|---|---|
| PROP-A | Property | tz Asia/Kolkata |
| R-101 | Room | just checked out → HOUSEKEEPING |
| U-HK | User | HOUSEKEEPING @ PROP-A (`housekeeping:update`) |
| NET | Connectivity | toggled offline/online in tests |
| CLOCK | Injected clock | server-timestamp conflict tests |

## US-1 — Clean a room
- **AC-1:** Given R-101 becomes HOUSEKEEPING after checkout, when the board loads, then a cleaning task for R-101 appears as PENDING. (FR-2)
- **AC-2:** Given U-HK marks R-101 clean, when submitted, then `rooms.changeRoomStatus(HOUSEKEEPING→VACANT)` is called, R-101 returns to availability, `HousekeepingTaskDone` + `RoomStatusChanged` emitted. (FR-3)
- **AC-3:** Given U-HK records linen + towel changed and a complaint "AC not cooling", when saved, then the task stores these and a `MaintenanceJob` (11) is raised for R-101. (FR-6)

## US-2 — Offline
- **AC-4:** Given NET offline, when U-HK marks R-101 clean, then the update is captured locally and queued (UI shows pending-sync). (FR-4)
- **AC-5:** Given NET returns, when sync runs, then the queued update posts with a server timestamp and the task/room reflect it. (FR-4)
- **AC-6:** Given an offline "clean" update whose `clientUpdatedAt` predates the room's re-occupation (`serverStatusChangedAt` later), when synced, then the write is detected **stale** (`clientUpdatedAt < serverStatusChangedAt`), **rejected (not applied)** and the conflict surfaced to U-HK for re-check; server state is untouched and **no illegal transition** occurs (02 also rejects OCCUPIED→VACANT via HK). (FR-5)

## US-3 — Realtime & permission
- **AC-7:** Given the board open on another device, when R-101 is marked clean, then that device updates < 2s. (FR-3)
- **AC-8:** Given U-HK, when attempting to view a folio/financials, then `FORBIDDEN`. (FR-8)
