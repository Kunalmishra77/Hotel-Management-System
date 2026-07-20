# 24 · Dynamic Pricing — Design

## Schema slice (from canonical `prisma/schema.prisma`)
Owns `DynamicRate` (unique `(roomCategoryId, date)`) with `status` (`DynamicRateStatus` enum SUGGESTED|APPROVED|REJECTED); category guardrails `RoomCategory.floorPaise`/`ceilPaise` — all **confirmed present in canonical schema** (migration materializes the slice).

## Domain layer (pure) — `features/dynamic-pricing/domain/`
- `suggestRate(base, occupancyBps, seasonFactor, leadTimeDays, floor, ceil): paise` — deterministic heuristic; clamped to [floor, ceil] (FR-1/3).
- `resolveRate(negotiatedRatePaise?, dynamicApproved?, ratePlan?, base): paise` — the fallback chain **reused by 03/23**: `negotiatedRatePaise` (passed in by caller, if any) → approved `DynamicRate` → `RatePlan` → base (FR-5). 24 never calls 25; the negotiated value arrives as an argument.

## Application — actions & jobs (`features/dynamic-pricing`)
- `runPricingEngine(propertyId, range)` — pg-boss job; optionally calls `18.suggestRates(propertyId, categoryId, range)`, then **24 writes/upserts** the `DynamicRate(SUGGESTED)` row (18 never writes `DynamicRate`). (FR-1)
- `approveRate(dynamicRateId, appliedPaise)` — `pricing:approve` (🔒); clamp guardrails; set APPROVED + approver; `DynamicRateApproved`. (FR-2/3)
- `rejectRate(id, reason)` — `pricing:approve`.
- Query `resolvedRate({categoryId, date, negotiatedRatePaise?})` for 03/23 (caller passes the negotiated rate from 25); on approval, notify 13 (push). (FR-4/5)

## UI — wireframes (mobile-first)
```
┌───────────────────────────┐
│ Rates · Deluxe            │
│ 26 Dec  base 4,000        │
│  suggest 6,900 (occ 90%)  │
│  [Approve 6,500][Reject]  │
│ 27 Dec  suggest 5,200     │
│  ⚠ above ceiling → 8,000  │
└───────────────────────────┘
```
Calendar of suggestions; approve/adjust within guardrails; approved rates flagged.

## Events
Emits: `DynamicRateApproved`, `DynamicRateRejected` (13/03/23 consume on approve to resolve/push). Obtains suggestions by calling `18.suggestRates` synchronously (and may also react to 18's `RateSuggested` event); either way **24 writes the `DynamicRate(SUGGESTED)` row** — `RateSuggested` is 18's event, not 24's. Catalog: `docs/architecture/domain-events.md`.

## Error catalog
`OUT_OF_BOUNDS`, `FORBIDDEN`, `VALIDATION_FAILED`.

## Edge cases
- Missing occupancy data → fall back to base suggestion; never fail.
- Approved rate later edited → new approval, audited; historical bookings keep their snapshotted rate (03/06).
- Guardrail change → existing approved rates unaffected until re-run.
- Resolution chain guarantees 03/23 never error on a missing dynamic rate (FR-5).
