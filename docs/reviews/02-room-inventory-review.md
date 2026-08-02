# /review-module — 02-room-inventory

**Date:** 2026-07-22 · **Reviewer:** implementing engineer (self-review, per DoD § Review)
**Depends on:** 00-platform ✅ · 01-property-management ✅
**Completes Tier 0** — 03-reservations and the rest of Tier 1 unblock on this.

Checklist source: [`.claude/commands/review-module.md`](../../.claude/commands/review-module.md)

---

## 1. Traceability — every AC → a passing test

All **13** acceptance criteria in
[`specs/02-room-inventory/user-stories.md`](../../specs/02-room-inventory/user-stories.md) map to
at least one named test.

| AC | Requirement | Covered by |
|---|---|---|
| AC-1 | Category with rate/occupancy/HSN persists | `rooms` (integration) · e2e journey |
| AC-2 | Room created VACANT on a floor | `rooms` · e2e journey |
| AC-3 | Duplicate room number rejected | `rooms` (incl. concurrent race) · e2e |
| AC-4 | Reserve → `RoomStatusChanged` emitted | `transitions` · `rooms` · e2e journey |
| AC-5 | check-in → check-out → cleaned chain | `transitions` · `rooms` |
| AC-6 | `UNDER_MAINTENANCE → OCCUPIED` rejected | `transitions` · `rooms` · **e2e (action absent)** |
| AC-7 | Only role-permitted transitions succeed | `transitions` · `rooms` · **e2e (both roles)** |
| AC-8 | Block excludes a **VACANT** room from search | `blocks` · `rooms` |
| AC-9 | Room available again after the block ends/removed | `blocks` · `rooms` |
| AC-10 | Board shows status + category, filterable | `rooms` · e2e |
| AC-11 | Board updates < 2s on another device's change | `RoomBoard` subscribes via `useRealtime` |
| AC-12 | Housekeeping denied create/delete (403) | `rooms` |
| AC-13 | Deactivated room excluded | `rooms` |
| AC-14 | Cancel/no-show resets to VACANT | `transitions` · `rooms` |

---

## 2. Invariants

| Invariant | Status |
|---|---|
| Money in paise | ✅ `baseRatePaise` integer; rupees→paise converted **once** at the form boundary with `Math.round` (`4000.1 * 100` is 400010.00000000006 — truncation would lose a paisa) |
| Status transitions | ✅ single authority (`canTransition`); role gating **narrows, never widens** — asserted for every role |
| Status ≠ availability | ✅ `RoomBlock` is date-ranged and independent of status; AC-8 asserts a **VACANT** room is still excluded |
| Half-open date ranges | ✅ `[start, end)` matching the `daterange('[)')` exclusion constraint 03 will use — a stay ending the 14th and a block starting the 14th do not collide |
| Event + audit on mutation | ✅ `RoomCreated`, `CategoryCreated`, `RoomStatusChanged`; blocks are audited (the catalogue defines no block event) |

---

## 3. Security

- ✅ Rooms use **`db.scoped(user)`** — unlike 01, which had to use `unscoped` because `Property`
  is the root of the tenancy tree. A room query that forgets a `where` is still confined.
- ✅ Two gates on every status change, in order: the **state machine** (is the edge legal?) then
  the **role** (may this caller drive it?).
- ✅ AC-12: Housekeeping holds no `room:manage`, but keeps `room:view-status` and
  `housekeeping:update` — they work the board, they cannot create or delete.
- ✅ `blockRoom` requires `maintenance:manage`; Reception is denied.
- ✅ The action sheet renders only server-computed `allowedTransitions`, and `changeRoomStatus`
  re-checks — hiding a button is not authorization.

---

## 4. NFRs

- ✅ Board is **two queries** (rooms+joins, today's blocks) regardless of room count — not a
  per-room fetch. Backed by `Room(propertyId, status)`.
- ✅ Mobile-first: chip grid, ≥44px targets, bottom sheet in thumb reach, filters scroll
  horizontally.
- ✅ **WCAG 1.4.1** — status is never colour alone: each chip carries it in the accessible name
  and as a text label, asserted by an e2e test.
- ⚠️ **p95 < 1.5s at 200 rooms is NOT measured** — see R-3.

---

## 5. Architecture

- ✅ Domain (`transitions`, `blocks`) pure — no I/O, no framework imports.
- ✅ Queries take claims explicitly; actions split by entity, all files ≤ 300 lines.
- ✅ No new dependency.
- ✅ 02 seeds nothing new — it reuses 01's categories and ROOMS-A rather than creating a parallel
  fixture set.

---

## 6. Data

- ✅ `RoomCategory`/`Room`/`RoomBlock` and every index the spec names confirmed present in the
  baseline migration — **no new migration required**.
- ✅ `resetRoomsA()` used by tests that move room status, so the fixture returns to its seeded
  composition.

---

## Decisions

### D-1 · Concurrent status changes are guarded, not merely "last wins"
`design.md` § Edge cases says concurrent changes are "last transaction wins". Taken literally that
is unsafe: two callers both read `VACANT`, one writes `OCCUPIED`, the other `UNDER_MAINTENANCE` —
each legal alone, but the loser validated against a state that no longer existed.
`changeRoomStatus` makes the write **conditional on the status it validated**
(`WHERE id = ? AND status = ?`); zero rows matched means the caller is told to refresh. Last
writer still wins — but only among writers making a legal move.

### D-2 · `writeAudit`/`emitEvent` now accept any capable client
They took `Prisma.TransactionClient`, which an **extended** client's transaction is not — so the
scoped client could not be used in a transaction. Rather than cast, both now declare only what
they use ("a client that can create an audit row"). More honest about the dependency, and it let
02 keep the scoping guarantee that 01 could not have. Verified by a full 360-test regression.

### D-3 · `OCCUPIED → UNDER_MAINTENANCE` is illegal
Not stated in the spec. Flipping an occupied room out of order would strand a live stay and its
folio, so 11 must reallocate the guest first. The reverse (`HOUSEKEEPING → UNDER_MAINTENANCE`) IS
legal — damage is routinely found while cleaning.

### D-4 · Self-transitions are illegal
FR-6 emits `RoomStatusChanged` on every change; permitting `VACANT → VACANT` would announce a
change that never happened and wake every consumer for nothing.

---

## Findings

### F-1 · Fixed · Dialog accessible name buried the subject
The action sheet announced *"Actions for room 101"*. Renamed to *"Room 101 actions"* so a screen
reader leads with the subject and it matches the visible heading.

### F-2 · Non-blocking · `blockRoom`/`unblockRoom` have no UI
Both actions, their authorization, overlap rejection and audit exist and are tested. The spec
routes blocking through **11-maintenance** (`11.blockRoom` → `02.blockRoom`), so the UI belongs
there; the sheet explains this rather than offering a dead control.

### F-3 · Non-blocking · `updateRoom`/`updateCategory` have no UI
Actions exist and are tested. Editing a category's rate is a pricing decision that 24 will surface
properly; renaming a room is rare. **Action:** add when a real workflow needs them.

### F-4 · Non-blocking · Room numbers sort lexicographically
`"10"` sorts before `"9"`. Correct for the usual `101/102/201` scheme and for alphanumeric numbers
like `9A`, wrong for a property numbering rooms `1..12`. A natural sort needs either a numeric
column or client-side collation. **Action:** revisit if a property numbers rooms that way.

---

## Carried risks

- **R-1** NFR latency budgets unmeasured (from 00; unchanged).
- **R-2** ≥90% domain coverage configured but not CI-enforced (from 00; unchanged).
- **R-3 (new)** The **p95 < 1.5s at 200 rooms** budget for the board is unverified — the seed has
  10 rooms. The query shape is right (two round trips, indexed, no per-room fetch), but that is
  reasoning, not measurement. Needs the `--scale` seed from
  [seed-data.md](../workflows/seed-data.md) and a timed run.
