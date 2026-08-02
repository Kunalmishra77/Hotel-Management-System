# /review-module — 25-corporate-crm

**Date:** 2026-08-03 · **Reviewer:** implementing engineer (self-review, per DoD § Review)
**Built by:** delegated subagent (parallel Tier-7 batch); **integrated + verified serially by the parent** (incl. the billing regression, since 25 refactored `reserveCredit`).
**Depends on:** 00. **Consumed by:** 06 (`reserveCredit`/`releaseCredit`), 03/23 (`getNegotiatedRate` → 24's `resolveRate`).
**Tier 7.** Owns `Corporate`, `TravelAgent`, `NegotiatedRate` (org-level).

## 1. Traceability — AC → test
**18 unit** + **13 integration** + **1 e2e**.

| AC | Requirement | Covered by |
|---|---|---|
| AC-1 | create corporate/agent + audit | integration |
| AC-2/11 | `getNegotiatedRate` → 24 resolves NEGOTIATED wins | integration |
| AC-3/4/10 | atomic credit under lock; reject over-limit; **concurrent-safe** | `available-credit` unit · integration (parallel reserve → one wins) |
| AC-5 | attribution report | integration |
| AC-6 | commission payable | `commission` unit · integration |
| AC-7 | statement + aging buckets | `aging` unit · integration · e2e |
| AC-8 | RBAC (`corporate:manage` / `report:view-financial`) | integration |

## 2. Invariants
| Invariant | Status |
|---|---|
| `reserveCredit` preserved for 06 | ✅ exact signature `(tx, corporateId, amountPaise)`; body refactored to pure `exceedsLimit` (identical outcome); billing suite re-run green |
| Credit atomic under row lock | ✅ `SELECT … FOR UPDATE` check-and-increment; concurrent test proves one wins, no over-limit/lost update |
| Money BigInt paise | ✅ creditLimit/receivable accumulate as BigInt |
| Org-level scoping | ✅ `corporate:manage` with null property scope; reads `db.unscoped()` + orgId |

## Decisions
- **D-1:** `reserveCredit` body now calls shared `exceedsLimit`; `releaseCredit` added (decrement, floor 0). 06 untouched.
- **D-2:** `getNegotiatedRate` provided; wiring 03/23 to feed it into 24's `resolveRate` is a follow-up (they're signed off).

## Carried risks
- **R-43** 03/23 negotiated-rate wiring + 15 statement export are documented follow-ups.
- **R-44** `CreditThresholdReached` event exists but isn't emitted (would change `reserveCredit`'s frozen behaviour) — a follow-up consumer of `CorporateReceivableChanged` should raise it.
