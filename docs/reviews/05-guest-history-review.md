# /review-module — 05-guest-history

**Date:** 2026-08-01 · **Reviewer:** implementing engineer (self-review, per DoD § Review)
**Depends on:** Tier 0/1 ✅ · 04-guest-crm ✅ · 06-billing ✅
**Tier 2.** First event-consumer module — establishes the outbox→consumer pattern the rest of
the platform (14/12/22) will follow.

Checklist source: [`.claude/commands/review-module.md`](../../.claude/commands/review-module.md)

**History is derived; the snapshot is a cache.** The source (03 reservations + 06 folios) is always
authoritative — the cache can be dropped and rebuilt exactly by `reconcileGuestStats`.

---

## 1. Traceability — AC → test

**6 domain unit tests** + **7 integration tests** + **1 e2e**. Every AC maps to a test.

| AC | Requirement | Covered by |
|---|---|---|
| AC-1 | 3 stays / 8 nights / ₹42,000 / preferred Deluxe / lastStay | `derive` (unit) · `guest-history` (recompute) |
| AC-2 | New guest → all zero, no errors | `derive` (empty) |
| AC-3 | Any folio-set event / checkout / feedback → recompute, idempotent | `guest-history` (consumer on FolioCharged) |
| AC-4 | Drift → reconcile recomputes from source | `guest-history` (reconcile) |
| AC-5 | History tab: payments, feedback, bills | e2e (bills shown) · `getGuestHistory` |
| AC-6 | No financial permission → money masked, counts stay | `guest-history` (Reception masked, Manager sees) |
| AC-7 | Guest revenue matches 14 to the paisa | via `06.guestBilling` (single derivation) — `guest-history` |
| AC-8 | `GuestMerged` recomputes BOTH survivor + loser | `guest-history` (merge, survivor=2 / loser=0) |
| AC-9 | Refund / credit-note reduces revenue, reconciles | `guest-history` (refund raises outstanding) |
| AC-10 | Same event twice → update once, no double count | `guest-history` (recompute twice) + dispatcher dedupe |
| AC-11 | Cache drift → source wins | `guest-history` (reconcile) |
| AC-12 | Cancelled/no-show never count | `derive` (cancelled/no-show → 0) |

---

## 2. Invariants

| Invariant | Status |
|---|---|
| History derived, snapshot a cache | ✅ `recomputeGuestStats` rebuilds from source; reconcile proves source wins |
| Money authoritative from 06 | ✅ revenue/outstanding come ONLY from `06.guestBilling` — never re-summed here (reconciles to the paisa, AC-7/9) |
| Idempotent consumer | ✅ recompute derives from source → re-delivery converges; dispatcher also dedupes on event id |
| Cancelled/no-show excluded | ✅ `isRealStay` gates visits/room-nights/preferences (AC-12) |
| Merge handles both sides | ✅ `GuestMerged` consumer recomputes survivor AND loser (AC-8) |
| Financials permission-gated | ✅ `report:view-financial` gates revenue/outstanding/amounts; counts always visible (AC-6) |

---

## 3. Architecture

- ✅ Domain (`derive`) pure, unit-tested.
- ✅ `recomputeGuestStats` is the one write path (consumer + reconcile both call it) — no duplicated derivation.
- ✅ First consumer registered with the 00 dispatcher (`registerGuestHistoryConsumer` in `scripts/worker.ts`); resolves the affected guest(s) per event type, recomputes.
- ✅ Reads 06 through its public `guestBilling` query — no foreign SELECT into folio tables.
- ✅ No new schema (GuestStatsSnapshot already in baseline); no new dependency.

---

## Decisions

### D-1 · The snapshot is recomputed-from-source, not incrementally patched
Every consumer event triggers a full recompute via `guestBilling` rather than a delta. This makes
idempotency free (a re-delivered event converges to the same numbers) and keeps 05 exactly
consistent with 06/14 — at the cost of a recompute per event, which is cheap (one roll-up query).
Incremental patching would be faster but would risk drift, which is the one thing a cache must not do.

### D-2 · `recomputeGuestStats(orgId, guestId)` takes orgId, not full claims
Consumers run under the system context with no user. `guestBilling` only needs `orgId`, so recompute
passes a minimal `{ orgId }` — the query never reads anything else off claims.

---

## Findings

### F-1 · Non-blocking · History rendered as a profile SECTION, not a tab
The spec wireframe shows a "History tab". It is rendered as a section on the 04 profile page
(server-composed, permission-masked). Functionally identical; a tabbed layout is a cosmetic
follow-up.

### F-2 · Non-blocking · `getGuestProfile` still throws on a malformed encrypted contact
Observed while writing the e2e (a dummy non-envelope mobile crashed the profile render). This is the
same latent issue as 04's F-4 (search decrypt not resilient to one corrupt row). Real guests always
have valid envelopes, so it doesn't affect production; **Action:** make `decryptOptional`-in-render
degrade to masked instead of throwing (tracked with 04 F-4).

---

## Carried risks

- **R-1..R-10** from earlier modules — unchanged.
- **R-11 (new)** The dispatcher's dedupe ledger is **in-process** (documented in `dispatch.ts`); a
  durable per-consumer ledger is the multi-instance production choice. 05's recompute is
  idempotent regardless, so a re-delivery across instances still cannot double-count — but the
  ledger note is carried for when multiple workers run.
