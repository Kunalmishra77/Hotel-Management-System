# 24 · Dynamic Pricing — Tasks

Suggestions need approval; resolution chain reused by 03/23. Each ends at `rules/definition-of-done.md`. `(AC-n)/(FR-n)`.

## Schema & migration
- [ ] T-1 `DynamicRate` (+ `DynamicRateStatus` enum) and `RoomCategory.floorPaise`/`ceilPaise` are **confirmed present in canonical schema**; migration materializes the slice + unique `(roomCategoryId, date)`.
- [ ] T-2 Seed fixtures (CAT-DLX with floor/ceil, occupancy data).

## Domain (tests first)
- [ ] T-3 `suggestRate` occupancy/season/lead-time + clamp. (FR-1/3, AC-1/2)
- [ ] T-4 `resolveRate(negotiatedRatePaise?, dynamicApproved?, ratePlan?, base)` fallback chain — negotiated (passed in) wins → approved → RatePlan → base; reused by 03/23. (FR-5, AC-6)

## Application (integration tests)
- [ ] T-5 `runPricingEngine` optionally calls `18.suggestRates`, then **24 upserts** `DynamicRate(SUGGESTED)` (no auto-apply; 18 writes no DynamicRate). (FR-1, AC-1)
- [ ] T-6 `approveRate` guardrail clamp + approver + event. (FR-2/3, AC-2/3)
- [ ] T-7 Publish approved → 03 resolves, 23 shows, 13 pushes. (FR-4, AC-4)
- [ ] T-8 RBAC: `pricing:approve` required to approve/reject. (FR-6, AC-5)

## UI (mobile-first)
- [ ] T-9 Rate calendar + approve/adjust within guardrails. (AC-1/2/3)

## E2E
- [ ] T-10 Journey: engine suggests → approve → booking on that date uses approved rate. (AC-1/3/4)

## Done
- [ ] T-11 `/review-module` clean; resolution chain consistent with 03/23; every AC → green test; DoD satisfied.
