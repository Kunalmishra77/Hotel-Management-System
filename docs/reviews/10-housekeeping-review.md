# /review-module — 10-housekeeping

**Date:** 2026-08-02 · **Reviewer:** implementing engineer (self-review, per DoD § Review)
**Depends on:** Tier 0/1 ✅ · 02-room-inventory (`changeRoomStatus`) ✅ · 11 (minimal surface) 
**Tier 2.** Mobile + offline is the point; the conflict-resolution guard is the crux.

Checklist source: [`.claude/commands/review-module.md`](../../.claude/commands/review-module.md)

---

## 1. Traceability — AC → test

**4 domain unit tests** + **6 integration tests** + **1 e2e**. Every AC maps to a test.

| AC | Requirement | Covered by |
|---|---|---|
| AC-1 | Room → HOUSEKEEPING → PENDING cleaning task appears | `housekeeping` (consumer, idempotent) · e2e |
| AC-2 | Mark clean → `changeRoomStatus(HOUSEKEEPING→VACANT)` + events | `housekeeping` (DONE→VACANT) · e2e |
| AC-3 | Linen/towel + complaint → task stores them + raises an 11 job | `housekeeping` (details → MaintenanceJob) |
| AC-4 | Offline mark-clean queued locally (pending-sync) | board queues to localStorage (offline event) — see D-2/R-note |
| AC-5 | On reconnect, queued update posts + reflects | `housekeeping` (syncOfflineUpdates applies fresh) · board flush |
| AC-6 | Stale offline write (`client < server`) rejected, surfaced, no illegal transition | `domain` (resolveConflict) · `housekeeping` (**stale → SYNC_CONFLICT, untouched**) |
| AC-7 | Board on another device updates < 2s | via `RoomStatusChanged` on the SSE broker (00) — not re-tested here |
| AC-8 | HK sees no financials/PII; role without `housekeeping:update` denied | `housekeeping` (Maintenance FORBIDDEN); folio guard lives in 06 |

---

## 2. Invariants

| Invariant | Status |
|---|---|
| No blind last-writer-wins | ✅ TWO guards: `resolveConflict` (task-level staleness) + 02's transition validation (room-level). A stale write is rejected AND a re-occupied room refuses HOUSEKEEPING→VACANT |
| Room status owned by 02 | ✅ 10 never writes `Room.status` directly — it calls `changeRoomStatus` (02's public surface) |
| Task creation idempotent | ✅ consumer creates one open task per room; a re-delivered `RoomStatusChanged` is a no-op |
| Complaint → maintenance via 11's surface | ✅ `raiseMaintenanceJob` (minimal pre-11 surface), not a foreign write |
| Every mutation: event + audit | ✅ `HousekeepingTaskDone` + audit; task-create/detail audited |
| RBAC + PII | ✅ `housekeeping:update`; the board carries no financials/PII (operational role) |

---

## Decisions

### D-1 · The conflict clock lives on the task's `serverStatusChangedAt`
The consumer advances a task's `serverStatusChangedAt` on ANY room status change (e.g.
re-occupation), so an offline "clean" whose `clientUpdatedAt` predates it is detected STALE — and
even if it weren't, 02 refuses OCCUPIED→VACANT. Two independent guards, matching AC-6's "not applied,
no illegal transition".

### D-2 · Offline queue via `online`/`offline` events + localStorage (not full background sync)
The board queues a mark-clean to localStorage when `navigator.onLine` is false and flushes through
`syncOfflineUpdates` on the `online` event. This is a real offline path (queue → conflict-checked
sync), but it does not survive an app close — full service-worker **background sync** is the
17-mobile-experience concern (R-12). The server-side sync + conflict logic is complete and tested.

### D-3 · Minimal `features/maintenance` surface before 11
Same pattern as ADR 0006: `raiseMaintenanceJob` exposes exactly what 10 needs so a complaint can
raise a job without 10 writing 11's table. 11 expands it next.

---

## Findings

### F-1 · Non-blocking · Full PWA background sync deferred (R-12)
The offline queue works within a live session; surviving an app kill + OS-scheduled background sync
belongs to 17. The conflict-resolution server logic — the part that must be correct — is done and
tested (AC-5/6).

---

## Carried risks

- **R-1..R-11** from earlier modules — unchanged.
- **R-12 (new)** Offline durability is session-scoped (localStorage + online event), not
  service-worker background sync (17). A mark-clean made offline is lost if the app is killed before
  reconnect; the server-side sync + stale-write rejection are complete regardless.
