# /review-module — 24-dynamic-pricing

**Date:** 2026-08-03 · **Reviewer:** implementing engineer (self-review, per DoD § Review)
**Built by:** delegated subagent (parallel Tier-5 batch); **integrated + verified serially by the parent.**
**Depends on:** 18 (`suggestRates`) · 14/analytics (occupancy) · 00. **Consumed by:** 23 (`getResolvedRate`), 13 (`DynamicRateApproved`), 03 (resolution — follow-up).
**Tier 5.** Owns `DynamicRate` + `RatePlan` writes.

## 1. Traceability — AC → test
**15 unit** + **9 integration** + **1 e2e**.

| AC | Requirement | Covered by |
|---|---|---|
| AC-1 | Engine suggests (occupancy/season/lead-time), no auto-apply | `suggest` unit · `dynamic-pricing` integration (→ SUGGESTED) |
| AC-2 | Suggestion clamped to floor/ceil + flagged | `suggest` unit |
| AC-3 | `approveRate` within guardrail + approver + event | integration (approve → APPROVED + `DynamicRateApproved`) |
| AC-4 | Published approved rate resolves for booking | integration (`getResolvedRate`) · e2e |
| AC-5 | RBAC: `pricing:approve` to approve/reject | integration (deny) |
| AC-6 | `resolveRate` chain: negotiated → dynamic → plan → base | `resolve` unit (priority + fall-through) |
| AC-7 | Approve out-of-band rejected (`RATE_OUT_OF_BOUNDS`) | integration |
| AC-8 | Base-safe when occupancy data missing | `suggest` unit |
| AC-9/11 | Concurrent approvals → one APPROVED; re-run preserves APPROVED | integration |

## 2. Invariants
| Invariant | Status |
|---|---|
| Suggestions never auto-apply | ✅ engine writes SUGGESTED; human approves |
| 18 writes no DynamicRate; 24 does | ✅ engine calls `18.suggestRates` (best-effort) then upserts itself |
| One resolution chain (03/23 reuse) | ✅ pure `resolveRate` + `getResolvedRate` query, exact signature 23 consumes |
| Never publish out of bounds | ✅ engine clamps; approve rejects out-of-band |
| Money in paise, Decimal math | ✅ |

## Decisions
- **D-1** Reconciled FR-3/AC-7 "clamp and flag" with the task's `RATE_OUT_OF_BOUNDS`: the engine **clamps + flags** suggestions; a human `approveRate` **rejects** an out-of-band typed rate. Both guarantee no out-of-bounds publish.
- **D-2** `getResolvedRate` picks the lowest-priced active `RatePlan` (RatePlan has no `active` flag) — documented.

## Carried risks
- **R-27** 03-wiring is a follow-up: the resolution contract is exported, but wiring 03 (signed off) to call it is deferred; 23 exercises resolution today.
- **R-28** The scheduled `runPricing` job no-ops until `PRICING_RUNNER_USER_ID` (a `pricing:approve` user) is configured; manual/authorized runs work now.
