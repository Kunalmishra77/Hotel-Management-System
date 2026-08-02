# /review-module — 11-maintenance

**Date:** 2026-08-02 · **Reviewer:** implementing engineer (self-review, per DoD § Review)
**Depends on:** Tier 0/1 ✅ · 02 (`blockRoom`/`unblockRoom`) ✅ · 03 (`reallocateRoom`) ✅ · 10 (raises jobs)
**Tier 2 complete** with this module. Expands the minimal maintenance surface 10 used.

Checklist source: [`.claude/commands/review-module.md`](../../.claude/commands/review-module.md)

---

## 1. Traceability — AC → test

**5 domain unit tests** + **7 integration tests** + **1 e2e**. Every AC maps to a test.

| AC | Requirement | Covered by |
|---|---|---|
| AC-1 | Create job → OPEN + `MaintenanceJobCreated` + audit | `maintenance` (create) · e2e |
| AC-2 | Housekeeping complaint auto-creates a job | `housekeeping` (10 → `raiseMaintenanceJob`) |
| AC-3 | Block a free room → 03 excludes it; unblock on close restores | `maintenance` (block links; close unblocks) — 03 exclusion tested in 03 |
| AC-4 | Close with cost → `closedAt` + cost + unblock + `MaintenanceJobClosed` | `maintenance` (close-unblock) · e2e |
| AC-5 | Reopen CLOSED → rejected | `domain` (canTransition) · `maintenance` (start on CLOSED → ILLEGAL) |
| AC-6 | Preventive reminder fires lead-days before due + recurs | `domain` (nextPreventiveDate) · `maintenance` (runPreventiveReminders) |
| AC-7 | Reception (no perms) → FORBIDDEN | `maintenance` (Reception denied) |
| AC-8 | Block over a confirmed reservation → `ROOM_HAS_RESERVATION`, nothing blocked | `maintenance` (overlap refused) |

---

## 2. Invariants

| Invariant | Status |
|---|---|
| A block never coexists with a live reservation | ✅ `blockRoomForJob` refuses when a CONFIRMED/IN_HOUSE allocation overlaps the range (`ROOM_HAS_RESERVATION`) — the inverse of no-overbooking (AC-8) |
| Room status/availability owned by 02/03 | ✅ 11 calls 02 `blockRoom`/`unblockRoom`; never writes `Room`/`RoomBlock` directly |
| Legal transitions only | ✅ `canTransition` (OPEN→IN_PROGRESS→CLOSED); CLOSED terminal (AC-5) |
| Block released on close | ✅ `closeJob` unblocks via 02 before committing — a block never outlives its job |
| Preventive recurrence idempotent | ✅ reminder fires once per due date, then `scheduledFor` advances (`nextPreventiveDate`) |
| Money in paise | ✅ `costPaise` integer |
| Every mutation: event + audit | ✅ `MaintenanceJobCreated`/`MaintenanceJobClosed`/`MaintenanceScheduled` + audit |
| RBAC server-side | ✅ `maintenance:manage`, deny-by-default (AC-7) |

---

## Decisions

### D-1 · `force` never bypasses a real overlap
The spec allows a `force` flag on `blockRoomForJob`, but the invariant is absolute: a block cannot
overlap a live reservation. So `force` is accepted but never overrides an actual CONFIRMED/IN_HOUSE
overlap — it is only meaningful once the guest has been reallocated (03), at which point there is no
overlap and no force is needed. The overlap check runs unconditionally.

### D-2 · The 10 → 11 complaint path uses `raiseMaintenanceJob` (the pre-11 surface)
10 raises a job in its own transaction via `raiseMaintenanceJob` (now emitting `MaintenanceJobCreated`,
corrected from the stub's placeholder event). `createJob` is the manual/UI entry point. Both produce
an OPEN job + the same event.

---

## Findings

### F-1 · Fixed (in 02) · `unblockRoom` used a scoped `delete` (the D-3 footgun)
Surfaced the moment 11 exercised it: 02's `unblockRoom` called `tx.roomBlock.delete({where:{id}})` on
the scoped client, whose extension wraps the `where` into a non-unique AND filter Prisma's
unique-where `delete` rejects. Changed to `deleteMany` (id still targets one row). A latent 02 bug
(the module noted its block actions had no UI), now fixed and covered by 11's close-unblock test.

### F-2 · Non-blocking · Block-room + preventive-schedule UI not wired
`blockRoomForJob` and the preventive scheduler are implemented and integration-tested; the board
exposes create/start/close. A block-room date picker and a preventive-schedule view are follow-ups
(the wireframe's "Preventive ▸" row) — the server logic is complete.

---

## Carried risks

- **R-1..R-12** from earlier modules — unchanged.
- No new module-specific risk. **Tier 2 is now complete** (05/06/07/09/10/11).
