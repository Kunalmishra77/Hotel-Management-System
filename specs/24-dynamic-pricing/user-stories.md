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
