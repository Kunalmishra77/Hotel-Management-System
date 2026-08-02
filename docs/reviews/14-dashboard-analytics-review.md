# /review-module — 14-dashboard-analytics

**Date:** 2026-08-02 · **Reviewer:** implementing engineer (self-review, per DoD § Review)
**Depends on:** Tier 0/1/2 ✅ · 06 (`postRoomCharges`) · 03 (`markNoShows`)
**Tier 3.** The metric authority (reused by 08) + night-audit orchestrator.

Checklist source: [`.claude/commands/review-module.md`](../../.claude/commands/review-module.md)

> **Build-order note:** 14 was built before 08 (its listed sibling) because 08 "reuses 14's metric
> library — no divergent math". The `features/analytics/domain` metric library is now the single
> definition 08 will import.

---

## 1. Traceability — AC → test

**8 domain unit tests** + **5 integration tests** + **2 e2e**. Coverage per AC below.

| AC | Requirement | Covered by |
|---|---|---|
| AC-1 | Occupancy/ADR/RevPAR per reporting.md (66.67% / ₹4,000 / ₹2,667) | `metrics` (unit — the exact fixture) |
| AC-2 | 08 reuses these functions, identical values | shared `features/analytics/domain/metrics` (08 imports it) |
| AC-3 | Live tiles: check-ins/outs, room counts, revenue/expense/pending | `analytics` (liveTiles) · e2e |
| AC-4 | Realtime tile update < 2s on `GuestCheckedIn` | **deferred — R-13** (SSE broker exists; dashboard subscription not wired) |
| AC-5 | Consolidation scoped to the caller's properties | `liveTiles`/`trend`/`segments` all take `propertyIds` scoped by the page |
| AC-6 | Financial tiles excluded server-side without permission | `analytics` (Reception null) · e2e (no revenue tile) |
| AC-7 | Night audit: post charges (06) → no-shows (03) → snapshot | `analytics` (runNightAudit COMPLETED) |
| AC-8 | Re-run idempotent → ALREADY_RUN, one snapshot | `analytics` (idempotent) |
| AC-9 | Business date rolls, `NightAuditCompleted` emitted | `analytics` (date roll + event) |
| AC-10 | Failure → run FAILED, date unchanged, safe re-run | catch sets FAILED + re-run resets it — **explicit fault-injection test deferred (R-14)** |
| AC-11 | Two concurrent runs → exactly one proceeds | `analytics` (Promise.all → one COMPLETED) |
| AC-12 | `PaymentDueDetected` on balance-due at close | emitted by 06's `postRoomCharges` (called in the audit) — 06 integration covers it |
| AC-13 | Trends read snapshots for closed dates | `analytics` (trend) |
| AC-14 | Segments: top corporates/agents/repeat guests | `segments` (corporates, live) — agents/guests are the same shape, **UI + full set R-15** |
| AC-15 | Closed-date metric is the immutable snapshot | `DailyStatSnapshot` unique + read-through |
| AC-16 | Scale: snapshot O(1) reads + pagination | trend reads indexed snapshots by `(propertyId,businessDate)` |

---

## 2. Invariants

| Invariant | Status |
|---|---|
| Metrics defined once | ✅ `features/analytics/domain/metrics` is the sole definition; 08 imports it (AC-2) |
| Money in paise, occupancy in bps | ✅ throughout; ADR/RevPAR rounded half-up |
| Night audit idempotent + concurrency-safe | ✅ `DailyStatSnapshot`/`NightAuditRun` unique `(propertyId,businessDate)` is the mutex; snapshot-exists short-circuits (AC-8/11) |
| Order: post charges → no-shows → snapshot → roll | ✅ `runNightAudit` sequence; each downstream call idempotent |
| Closed date immutable | ✅ snapshot is the read for closed dates; date rolls + is locked |
| Financial data permission-gated | ✅ `liveTiles` nulls financial fields server-side without `report:view-financial` (AC-6) |
| 14 posts nothing to folios | ✅ reads only; charges come from 06 |

---

## Decisions

### D-1 · The `NightAuditRun` unique row is the mutex (no session advisory lock)
Rather than a session-scoped `pg_advisory_lock` spanning the multi-transaction orchestration, the
unique `(propertyId, businessDate)` run row is the claim: `create` wins for exactly one racer; the
loser reads RUNNING/COMPLETED and stands down; a FAILED row is reset with a conditional
`updateMany`. Simpler and durable across the separate 06/03 transactions. Verified by the
concurrency test.

### D-2 · Live occupancy tile vs report occupancy
`liveTiles.occupancyBps` is the **point-in-time** status rollup (occupied ÷ active-non-maintenance),
per reporting.md's distinction (b); the **range** occupancy for reports/snapshots uses
room-nights (a). Both call the same `occupancy()` — different denominators, one definition.

---

## Findings

### F-1 · Non-blocking · Dashboard is not yet live-updating (R-13)
Tiles are server-rendered per load. The SSE broker (00) and the tile-affecting events exist, but the
dashboard doesn't yet subscribe to recompute-and-push (AC-4). **Action:** wire the client to the SSE
channel and refresh affected tiles — a UI/17 concern; the data + events are ready.

### F-2 · Non-blocking · Trends/segments have queries but not charts
`trend` and `segments` (corporates) are implemented and tested; the chart/list UI (T-19) and the
agents/repeat-guests segment breakdowns are follow-ups.

---

## Carried risks

- **R-1..R-12** from earlier modules — unchanged.
- **R-13 (new)** Realtime dashboard push (AC-4) deferred — server data + events ready, client SSE
  subscription not wired.
- **R-14 (new)** AC-10's FAILED path is handled in code (catch → FAILED, re-run resets) but not
  fault-injection-tested; idempotent re-run IS tested.
- **R-15 (new)** Segments returns top corporates; agents + repeat-guests breakdowns and the
  segment/trend UI are follow-ups (AC-14 partial).
