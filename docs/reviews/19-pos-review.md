# /review-module — 19-pos

**Date:** 2026-08-03 · **Reviewer:** implementing engineer (self-review, per DoD § Review)
**Built by:** delegated subagent (parallel Tier-6 batch); **integrated + verified serially by the parent.**
**Depends on:** 06 (folio helpers) · new shared `lib/tax`. **Consumed by:** 20 (`PosOrderSettled`), 03 checkout gate (`unsettledOrders`).
**Tier 6.** Owns `PosOutlet`, `MenuItem`, `PosOrder`, `PosOrderItem`. Money only via 06.

## 1. Traceability — AC → test
**17 unit** + **17 integration** + **1 e2e**.

| AC | Requirement | Covered by |
|---|---|---|
| AC-1 | `orderTotal` derived; gap-free code | `order-total` unit · integration |
| AC-2/3 | `billPreview` GST (CGST+SGST, round-off) | `tax` + `bill-preview` unit · integration |
| AC-4 | create/addItem/removeItem OPEN-only + validation | integration |
| AC-5 | `settleToFolio` → 06 posts FolioLine (POS writes none) + event | integration |
| AC-6 | Invalid folio target → `FOLIO_TARGET_INVALID` | integration (×2) |
| AC-7 | `settleDirect` → 06 DIRECT_SALE | integration |
| AC-8 | `PosOrderSettled` payload drives 20 | integration |
| AC-9 | `canTransition` OPEN→SETTLED→VOID; immutable | `state` unit · integration |
| AC-10 | void → 06 reversal / credit note | integration |
| AC-11 | discount threshold + `folio:discount` override | integration |
| AC-12 | KOT without settle | `kot` unit · integration |
| AC-13 | `unsettledOrders` checkout gate | integration |
| AC-14 | Concurrent settle → one wins, other `ORDER_NOT_OPEN`, one charge | integration (concurrency) |
| AC-15 | RBAC deny | integration |

## 2. Invariants
| Invariant | Status |
|---|---|
| Money only via 06 | ✅ settle/void call `ensureFolio`/`postFolioCharge`/`settlePosSaleDirect`/`reverseFolioLine`; POS writes no FolioLine/Payment/Invoice |
| No double-post under concurrency | ✅ `SELECT … FOR UPDATE` claim OPEN→SETTLED; saga compensation on 06 failure; concurrency test proves one charge |
| Gap-free order code | ✅ per-property `pg_advisory_xact_lock` counter (via `$executeRaw`) |
| GST correct (property-state → CGST+SGST) | ✅ shared `lib/tax`, half-up |

## Decisions
- **D-1 (verify at reconcile — accepted):** the folio charge posts as type **`FOOD`**, not literal `POS`. 06 derives GST from charge type and its `POS` type is 18%, but restaurant F&B is 5% (SAC 996331); `FOOD` yields the money-correct 5% split and matches 06's own walk-in path. Isolated in `POS_FOLIO_CHARGE_TYPE`.
- **D-2:** settlement is a saga (06 self-transacts) — claim under a short lock, call 06, compensate on failure — never a long-held cross-transaction lock.
- **D-3:** `pg_advisory_xact_lock` via `$executeRaw` (not `$queryRaw`, which can't deserialize `void`) — fixed at merge.

## Carried risks
- **R-34** Folio charge type `FOOD` vs spec's literal `POS` (D-1). Cleaner long-term: `postFolioCharge` accepts an explicit tax rate, or `CHARGE_GST_BPS.POS` = 5% for F&B outlets.
- **R-35** Mixed-rate menu on the folio path would need per-rate-group posting (blocked by 06's rate-from-type); uniform-rate F&B (the fixtures) is exact.
- **R-36** AC-11 deny-half asserts the override-audit path (no seeded role has create-without-discount) — same limitation as the billing suite.
