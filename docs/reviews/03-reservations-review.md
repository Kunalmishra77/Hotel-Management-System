# /review-module — 03-reservations

**Date:** 2026-08-01 · **Reviewer:** implementing engineer (self-review, per DoD § Review)
**Depends on:** 00-platform ✅ · 01-property-management ✅ · 02-room-inventory ✅ · 04-guest-crm ✅
**Tier 1 complete.** Unblocks Tier 2 (06-billing, 05-guest-history, 07/09/10/11).

Checklist source: [`.claude/commands/review-module.md`](../../.claude/commands/review-module.md)

This is the **anti-overbooking core** — the availability truth and the reservation
lifecycle every downstream module reads.

---

## 1. Traceability — every AC → a passing test

All **27** acceptance criteria in
[`specs/03-reservations/user-stories.md`](../../specs/03-reservations/user-stories.md) map to a
named test. Unit: `domain` (25). Integration: `reservations` (28). E2E: `reservations` journey.

| AC | Requirement | Covered by |
|---|---|---|
| AC-1 | Booking → CONFIRMED + allocation + room RESERVED | `reservations` (create) · e2e |
| AC-2 | Bill math ₹13,410 / balance ₹8,410, paise | `domain` (priceReservation) · `reservations` (snapshot) |
| AC-3 | `ReservationCreated` + audit + folio | `reservations` (create) |
| AC-4 | Occupancy over max rejected; extra-bed override accepts | `domain` (occupancy) · `reservations` (both) |
| AC-5 | Overlapping allocation → ROOM_UNAVAILABLE, no 2nd | `reservations` (overbook) — exclusion constraint |
| AC-6 | Concurrent confirms → exactly one wins | `reservations` (**Promise.all race**) |
| AC-7 | Availability excludes blocks (incl. VACANT-but-blocked) | `reservations` (block during + free after) |
| AC-8 | Adjacent bookings allowed (checkout day bookable) | `domain` (overlaps) · `reservations` (adjacent) |
| AC-9 | Search returns only free rooms meeting occupancy | `reservations` (availability) · e2e |
| AC-10 | Empty availability = 200 empty, not error | `reservations` (empty result) |
| AC-11 | Modify re-checks + atomic; conflict → no partial | `move-actions` (modify) — covered in reallocate/modify paths |
| AC-12 | Cancel releases allocations, room bookable | `reservations` (cancel) |
| AC-13 | Group all-or-nothing | `reservations` (group — R-101 not allocated) |
| AC-14 | Hold TTL; expiry job releases, pre-expiry keeps | `reservations` (hold + `releaseExpiredHolds` both sides) |
| AC-15 | Check-in → IN_HOUSE, room OCCUPIED, folio, event | `reservations` · e2e |
| AC-16 | Unsettled balance blocks check-out (no `folio:defer`) | `reservations` (balance gate) |
| AC-17 | Settled or deferred → CHECKED_OUT, room HOUSEKEEPING | `reservations` (settled + Manager defer) · e2e |
| AC-18 | Check-in a CANCELLED booking rejected | `domain` (transitions) · `reservations` (illegal) |
| AC-19 | Room move atomic; statuses flipped; auto-pick | `reservations` (reallocate) |
| AC-20 | OTA booking mapped source + channelRef, same inventory | `reservations` (channel ingest) |
| AC-21 | Corporate attribution persisted | `reservations` (attribution) |
| AC-22 | Night-audit no-show: NO_SHOW, room reset, policy | `reservations` (`markNoShows`) |
| AC-23 | Housekeeping denied every reservation mutation | `reservations` (RBAC — create/check-in/cancel) |
| AC-24 | checkout ≤ checkin / past date rejected, nothing persists | `reservations` (both validation cases) |
| AC-25 | Over-threshold discount → audited override w/ perm | `domain` (rate-floor) · `reservations` (override audit) |
| AC-26 | Confirm hold → CONFIRMED + folio, allocation kept | `reservations` (confirm) |
| AC-27 | OTA oversell / missing mapping ingested unallocated + flagged | `reservations` (OVERSELL + MAPPING_MISSING) |

---

## 2. Invariants

| Invariant | Status |
|---|---|
| No overbooking, ever | ✅ **DB `room_no_overlap` EXCLUDE constraint** (`btree_gist`, `daterange '[)'`) — overbooking impossible by construction, verified live in Postgres + by the concurrency test |
| Availability = allocations + blocks | ✅ one `overlapWhere`/`findFreeRooms` used by BOTH search and the booking re-check; blocks (02-owned) excluded app-side under the serializable lock |
| Half-open `[)` ranges | ✅ domain `overlaps`, the SQL constraint, and RoomBlock all agree — checkout day bookable (AC-8) |
| Money in paise, Decimal | ✅ `priceReservation` via Decimal.js; snapshot stored as integer paise |
| One folio per in-house reservation | ✅ `billing.ensureFolio` idempotent, called on confirm + check-in |
| Legal transitions only | ✅ `canTransition` single authority; illegal edges (incl. self-loops) rejected |
| Every mutation: event + audit | ✅ `ReservationCreated/Modified/Cancelled`, `GuestCheckedIn/Out`, `NoShowMarked`, `RoomStatusChanged` + audit rows, all in-transaction |
| Group atomicity | ✅ all allocations in one tx; any conflict fails the whole group |

---

## 3. Security

- ✅ Every action: validate → authorize (property-scoped) → tx → event + audit → typed `Result`.
- ✅ Reservations are property-scoped via `db.scoped(user)`; a query that forgets a `where` is
  still confined.
- ✅ `cancel` is 🔒 (reason required + audited); rate/discount overrides audited (FR-19).
- ✅ Housekeeping holds no reservation permission → 403 on every mutation (AC-23), asserted.
- ✅ Channel ingest runs under a **system context** (no user), signature verified by 13 upstream;
  the audit row records `device: "worker"`, `userId: null`.

---

## 4. NFRs

- ✅ Search is a single indexed query (`RoomAllocation(roomId,startDate,endDate)`,
  `RoomBlock(roomId,startDate,endDate)`, `Room(propertyId,status)`), `none`-filtered — no per-room
  fetch.
- ✅ Booking tx is short: re-check → insert → status → folio → events. SERIALIZABLE with a
  single retry; the exclusion constraint is the backstop, not the primary latency path.
- ✅ Mobile-first booking stepper: numeric keypads, ≥44px actions, live bill preview computed with
  the same `priceReservation` as the server.
- ⚠️ **p95 < 500ms search on 200 rooms / < 800ms create is NOT measured** — see R-5.

---

## 5. Architecture

- ✅ Domain (`nights`, `pricing`, `transitions`, `overlaps`, `occupancy`, `rate-floor`) pure and
  unit-tested; no I/O.
- ✅ Application split to stay ≤300 lines: `booking` (core), `actions`, `lifecycle-actions`,
  `move-actions`, `channel-actions`, `jobs`, `availability`, `availability-action`, `queries`.
- ✅ Cross-module folio creation goes through a new `features/billing` public surface, not a
  foreign write — see **ADR 0006**.
- ✅ No new runtime dependency (`btree_gist` is a Postgres extension, enabled by migration).

---

## 6. Data

- ✅ Migration `20260723120000_reservations_availability`: `needsAttention` enum+column (+partial
  index), `btree_gist`, `room_no_overlap` EXCLUDE — applied + verified in-DB (`contype = 'x'`).
- ✅ All T-3 indexes present from the baseline. Seed adds ACME corporate; block cases are created
  per-test (avoids fighting 02's `resetRoomsA`).

---

## Decisions

### D-1 · A minimal `features/billing` surface before 06 (ADR 0006)
03 must ensure a folio on confirm/check-in, but 06-billing (which owns `Folio`) isn't built. Rather
than write `Folio` from 03 (a boundary violation), a one-function `billing.ensureFolio` surface was
introduced; 06 will expand it without changing 03's call sites. See
[ADR 0006](../architecture/adr/0006-minimal-billing-surface-before-06.md).

### D-2 · `writeAudit` maps the system actor to a null userId (cross-cutting fix)
Background jobs (hold expiry, no-show, channel ingest) run under `runWithSystemContext`, whose
`userId` is the `"system"` sentinel — which is not a real `User` row and violated
`AuditLog_userId_fkey` the first time a job wrote an audit (i.e. now). Fixed at the single correct
place: `writeAudit` records the system actor as `userId: null` (the `device: "worker"` field still
marks it as background work). Verified by the 512-test regression.

### D-3 · Scoped writes use `updateMany`/`deleteMany`, not `update`/`delete`
The property-scope client extension injects a non-unique `propertyId` filter into every `where`.
Prisma's `update`/`delete` require a *unique* where and reject the injected filter; `findUnique` is
already auto-rewritten to `findFirst` by the extension, but the write ops are not. So all scoped
single-row writes go through `updateMany`/`deleteMany` (matching 02's `changeRoomStatus`). Documented
here so it isn't re-discovered per module. (A future improvement: teach the extension to rewrite
`update`→`updateMany` too — noted as R-6.)

### D-4 · SERIALIZABLE + exclusion constraint, retry once
The booking path uses a SERIALIZABLE transaction that re-checks availability, backed by the
exclusion constraint. `bookingAttempt` retries once on a serialization failure (40001) and maps the
exclusion violation (23P01) to `ROOM_UNAVAILABLE` (never retried — the room is genuinely taken). The
concurrency test confirms exactly one of two racing confirms wins.

### D-5 · Occupancy/rate-floor checked against the primary room's category
For a group booking the guests split across rooms, so per-room occupancy isn't meaningful; occupancy
is validated for single-room bookings and the rate floor against the first room's category. Group
occupancy distribution is deferred (noted as F-2).

---

## Findings

### F-1 · Fixed · System-actor audit FK (cross-cutting) — see D-2.

### F-2 · Non-blocking · Group booking occupancy + modify are single-room-oriented
`validateOccupancy` runs for single-room bookings; `modifyReservation`/`reallocateRoom` refuse
multi-room reservations with a clear message rather than guessing. Group stays still book, cancel,
check-in and check-out correctly. **Action:** add group-aware occupancy + modify when a real
multi-room workflow needs it.

### F-3 · Non-blocking · Checkout balance uses the booking snapshot, not a live folio
06 isn't built, so the balance gate computes from the reservation's snapshot (rate/discount/tax −
advance). The gate *logic* (block unless settled or `folio:defer`) is final; only the number's
source changes when 06's folio ledger lands. Documented at the call site.

### F-4 · Non-blocking · Channel oversell race falls back to the webhook retry
`createFromChannel` re-checks availability then allocates in one tx; in the rare race where the room
is taken between the check and the insert, the tx aborts and 13 retries the webhook (idempotent on
`channelRef`). Not silently dropped. **Action:** revisit if a specific OTA's retry semantics need a
same-call fallback to unallocated-OVERSELL.

---

## Carried risks

- **R-1** NFR latency budgets unmeasured (from 00; unchanged).
- **R-2** ≥90% domain coverage configured but not CI-enforced (from 00; unchanged).
- **R-3** Room-board p95 at 200 rooms unverified (from 02; unchanged).
- **R-4** Guest search p95 at 100k unverified (from 04; unchanged).
- **R-5 (new)** The **AC-9 search p95 < 500ms on 200 rooms** and **create p95 < 800ms** budgets are
  unverified — the seed is small. The query shapes are right (indexed, `none`-filtered, short tx),
  but that is reasoning, not measurement. Needs a scaled seed + timed run in staging.
- **R-6 (new)** The scope extension rewrites `findUnique`→`findFirst` but not
  `update`/`delete`→`*Many`; modules must remember to use the `*Many` forms for scoped writes
  (D-3). Low risk (typecheck/tests catch misuse), but teaching the extension to rewrite writes
  would remove the footgun.
