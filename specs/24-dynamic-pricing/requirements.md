# 24 · Dynamic Pricing — Requirements

> Source: client doc §19. Read with `rules/reporting.md` (occupancy), `rules/ai-features.md` (suggestions need approval), `prisma/schema.prisma` (`DynamicRate`). Depth bar: `specs/03-reservations/*`.

## Purpose & scope
Suggest per-category, per-date room rates based on occupancy, season, and lead time; require **human/threshold approval** before an applied rate publishes; feed approved rates to reservations (03), the booking engine (23), and OTAs (13).

**In scope:** rate-suggestion engine (rules + optional AI from 18) writing `DynamicRate.suggestedPaise`; approval workflow → `appliedPaise`; publish approved rates to 03/23/13; guardrails (floor/ceiling per category).
**Out of scope:** the rate-suggestion ML/heuristics detail (18 may supply); rate application at booking (03 consumes the resolved rate); channel push mechanics (13); folio pricing (06).

## Dependencies
- **Tier 0–5:** 00, 01, 02 (`RoomCategory`/`RatePlan`), 14 (occupancy), 18 (AI suggestions optional).
- **Consumed by:** 03 (resolved rate), 23 (booking engine), 13 (OTA push).

## Data owned
`DynamicRate` (unique `(roomCategoryId, date)`) with `status` (`DynamicRateStatus` enum SUGGESTED|APPROVED|REJECTED) and `RoomCategory.floorPaise`/`ceilPaise` guardrails — all **confirmed present in canonical schema** (migration materializes the slice; nothing new).

## Functional requirements (EARS)
- **FR-1 (event):** When the pricing engine runs for a category/date range, compute `suggestedPaise` from occupancy (14), season, and lead time — optionally calling `18.suggestRates(propertyId, categoryId, range)` for a smarter suggestion — and **24 itself writes/upserts** the `DynamicRate(SUGGESTED)` row (18 never writes `DynamicRate`); never auto-apply.
- **FR-2 (event):** When an authorized user approves a suggestion (`pricing:approve`, per `rbac-matrix.md`), set `appliedPaise` + `APPROVED` and record approver; emit `DynamicRateApproved`.
- **FR-3 (unwanted):** If a suggested/approved rate falls outside the category floor/ceiling guardrails, reject/clamp and flag for review — never publish an out-of-bounds rate.
- **FR-4 (event):** When a rate is approved, publish it so 03 resolves it at booking, 23 shows it, and 13 pushes it to OTAs (via their consumers).
- **FR-5 (ubiquitous):** The resolved rate is exposed as `resolvedRate(in: {categoryId, date, negotiatedRatePaise?})` (contracts): if the caller (03/23) passes a `negotiatedRatePaise` — which it obtains from `25.getNegotiatedRate(corporateId, categoryId)` for a corporate-attributed booking — that wins; else approved `DynamicRate` for the date if present, else `RatePlan`, else `RoomCategory.baseRatePaise` — search/booking **never fails** for a missing dynamic rate. 24 does **not** call 25; the negotiated rate is passed in by the caller.
- **FR-6 (ubiquitous):** Every suggestion/approval is property-scoped, authorized, audited, and emits its event; money in paise.

## Non-functional (cited)
Engine runs as a pg-boss job off the hot path; approval UI usable on a phone; resolution O(1) per (category,date). (`non-functional-requirements.md`)

## Business rules referenced
`ai-features.md` (suggestions need human/threshold approval before publish), `business-rules.md` §20–21, `reporting.md` (occupancy input).
