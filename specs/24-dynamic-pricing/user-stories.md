# 24 · Dynamic Pricing — User Stories & Acceptance Criteria

Roles per `rules/user-roles.md`. Suggestions never auto-apply.

## Test Fixtures
| Ref | Value |
|---|---|
| CAT-DLX | Deluxe, base ₹4,000, floor ₹3,000, ceil ₹8,000 |
| DATE | 26 Dec 2026 (high season, high occupancy) |
| U-MGR | MANAGER (has `pricing:approve`) |
| U-REC | RECEPTION (no `pricing:approve`) |

## US-1 — Suggest
- **AC-1:** Given CAT-DLX at 90% occupancy + peak season on DATE, when the engine runs (optionally calling `18.suggestRates`), then **24** upserts a `DynamicRate(SUGGESTED)` with `suggestedPaise` > base (18 writes no `DynamicRate`); nothing is auto-applied. (FR-1)
- **AC-2:** Given a suggestion computed above the ceiling ₹8,000, when produced, then it is clamped/flagged — never published out of bounds. (FR-3)

## US-2 — Approve & publish
- **AC-3:** Given U-MGR approves the suggestion at ₹6,500, then `appliedPaise=650000`, status APPROVED, approver recorded, `DynamicRateApproved` emitted. (FR-2)
- **AC-4:** Given approval, when 03 resolves a booking for DATE, when 23 shows the rate, and when 13 pushes to OTAs, then all use ₹6,500. (FR-4)
- **AC-5:** Given U-REC (no `pricing:approve`), when approving, then `FORBIDDEN`. (FR-6)

## US-3 — Resolution fallback
- **AC-6:** Given `resolvedRate({categoryId, date, negotiatedRatePaise?})`: a passed-in `negotiatedRatePaise` (from `25.getNegotiatedRate`, corporate booking) wins; with none passed and no approved DynamicRate for the date, 03/23 fall back to `RatePlan` then `baseRatePaise` — booking never fails. (FR-5)

## US-4 — Guardrails, edge & concurrency
- **AC-7:** Given a suggestion computed **above the ceiling ₹8,000** (or below the floor ₹3,000), when produced/approved, then it is **clamped to the band and flagged** (`OUT_OF_BOUNDS`) — an out-of-bounds rate is never published. (FR-3, AC-2)
- **AC-8:** Given occupancy data is unavailable for a date, when the engine runs, then it **falls back to the base suggestion and does not fail** (no divide-by-zero, no crash). (FR-1)
- **AC-9:** Given two managers **approve the same `(category, date)` suggestion concurrently**, then exactly **one** `APPROVED` row results (unique `(roomCategoryId, date)`); no double publish. (FR-2)
- **AC-10:** Given a `SUGGESTED` rate that no one approves, when 03/23 resolve a rate for that date, then the suggestion is **never used** — only `APPROVED` rates publish (human-in-the-loop). (FR-1/7)
- **AC-11:** Given an already-`APPROVED` rate is later re-run/re-suggested, then existing bookings keep their **snapshotted** rate (06/03); only future resolutions see the new one. (FR-4)
