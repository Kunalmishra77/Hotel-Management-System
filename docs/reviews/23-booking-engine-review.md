# /review-module — 23-booking-engine

**Date:** 2026-08-03 · **Reviewer:** implementing engineer (self-review, per DoD § Review)
**Built by:** delegated subagent (parallel Tier-5 batch); **integrated + verified serially by the parent** (incl. the no-overbooking + public-surface security tests).
**Depends on:** 03 (availability/hold/confirm/reallocate) · 06 (folio/payment/coupon) · 24 (`getResolvedRate`) · `lib/payments` · 00.
**Tier 5.** Owns `BookingEngineConfig`, `BookingEngineOrder`. Public + payment surface.

## 1. Traceability — AC → test
**20 unit** + **19 integration/security** + **1 e2e**.

| AC | Requirement | Covered by |
|---|---|---|
| AC-1/2/3 | Availability: sellable-only, GST-inclusive, base fallback, no room#/PII | integration + `gst-display` unit · e2e |
| AC-4/5/13 | Hold: constraints + consent + 04 upsert + 03 hold + gateway order | integration · e2e |
| AC-5 | Deposit (full/pct/fixed) | `deposit` unit |
| AC-6 | Success webhook → confirm(03) + advance(06) + PAID + `WebBookingConfirmed` | integration · e2e |
| AC-7 | Hold-lost → reallocate else auto-refund; **never overbook** | integration (reallocate + auto-refund paths) |
| AC-8 | Fail/abandon/TTL → release hold + terminal order | integration (+ TTL sweeper) |
| AC-9/10 | Signature verify + inbox dedupe | integration (bad sig; duplicate webhook) |
| AC-11 | Rate-limit per IP+route → 429, no side effects | integration (security) |
| AC-12 | Bot/abuse rejected before hold/order + audit | integration (security) |
| AC-14 | Stay constraints (LOS/lead-time/rooms/occupancy) | `constraints` unit |
| AC-16 | Idempotency key dedupes double-submit | integration |
| AC-18 | GST-inclusive display == charged | `gst-display` unit |
| AC-19 | Staff config gated on `bookingengine:manage`; public stays open | integration (RBAC allow/deny) |
| AC-20 | Coupon preview → redeem-once; abandoned redeems nothing | integration |
| — | No overbooking under concurrent last-room | integration (concurrency) |

## 2. Invariants
| Invariant | Status |
|---|---|
| No overbooking, ever | ✅ hold/confirm via 03's `room_no_overlap` exclusion constraint in SERIALIZABLE tx; concurrency test proves only one hold wins |
| Public surface hardened | ✅ rate-limit 429 (no side effects), bot rejection pre-hold, idempotency dedupe, no other-guest PII / no internal room# in responses |
| Payment off a real gateway in sandbox | ✅ `lib/payments` sandbox default; webhook signature-verified first + inbox-deduped |
| GST: place-of-supply = property state | ✅ CGST+SGST via `RoomCategory.gstBps`; display == charged |
| Money in paise | ✅ |

## Decisions
- **D-1** Public flow runs under `runWithSystemContext(orgId)` (no user) — same established pattern as 03 `createFromChannel` / 06 payment webhook — reusing 03's availability truth + 06's folio.
- **D-2** `PaymentProvider.refund` added to the interface + sandbox adapter (parent) so FR-8 auto-refund is real, not a defensive no-op.
- **D-3** Middleware `PUBLIC_PREFIXES` gained `/book` + `/api/booking-engine` (public, unauthenticated by design; webhooks stay signature-verified).

## Carried risks
- **R-29** Public hold/confirm/coupon re-use 03/06 truth but via system-context paths / re-implemented coupon gates (06's are user-gated); exposing system-callable 03 hold + 06 coupon helpers is a cleaner follow-up.
- **R-30** Rate limiter is in-process (fine per tech-stack.md); a multi-instance deploy needs a shared store behind `checkRateLimit`.
- **R-24** Live payment gateway (Razorpay/Cashfree) pending client KYC — sandbox covers every path.
