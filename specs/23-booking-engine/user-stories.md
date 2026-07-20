# 23 · Booking Engine — User Stories & Acceptance Criteria

Public, unauthenticated, mobile-first. Booking creates a WEBSITE reservation via 03, folio+advance via 06. One availability truth.

## Test Fixtures
| Ref | Entity | Value |
|---|---|---|
| PROP-A | Property | public slug `woodpecker-mg`, GST-inclusive display |
| CFG | BookingEngineConfig | onlineSellable CAT-DLX; deposit=20%; TTL=15min; minLOS 1; cancel window 48h |
| CAT-DLX | RoomCategory | Deluxe, resolved rate ₹4,000/night (via 24, GST 12%) |
| GUEST | Public guest | name/mobile/email + consent |
| PAY | PaymentProvider | sandbox mode (no live creds) |
| CLOCK | Injected clock | TTL/idempotency/webhook tests |

## US-1 — Search & display
- **AC-1:** Given `/api/booking-engine/v1/woodpecker-mg/availability?in=12Jul&out=15Jul&adults=2`, when called (no session), then per-category availability + resolved sellable rate (via `24.resolvedRate`, no negotiated rate for public) with a **GST-inclusive** display price computed from `RoomCategory.gstBps` is returned, against 03's availability truth. (FR-1/3/15)
- **AC-2:** Given only CAT-DLX is `onlineSellable`, when browsing, then non-sellable categories, internal room numbers, staff data, and other guests' PII are never exposed. (FR-2/20)
- **AC-3:** Given a missing resolved dynamic rate, when searching, then it falls back to `RatePlan`/`baseRatePaise` — search never fails. (FR-18)

## US-2 — Book & pay (hold → gateway → confirm)
- **AC-4:** Given a chosen category + guest details + consent, when submitted, then a `Guest` is upserted via 04 (dedupe on mobile/email) and a **temporary hold** (ENQUIRY, WEBSITE, TTL 15min) is placed via 03; a `BookingEngineOrder` binds gatewayOrder↔hold↔amount↔idempotency key. (FR-4/5)
- **AC-5:** Given a hold, when the deposit order is created (20% of total), then only the gateway params the client needs are returned (no secrets). (FR-5)
- **AC-6:** Given a verified payment-success webhook, when processed in one transaction, then the hold is confirmed via 03 (→CONFIRMED, ensureFolio), the advance `Payment` recorded via 06, order → PAID, `WebBookingConfirmed` emitted, and 12 sends the confirmation. (FR-7/21)

## US-3 — Failure & safety (never overbook)
- **AC-7:** Given payment succeeds but the hold **expired**/room gone, when processed, then `03.reallocateRoom(reservationId)` re-allocates to an equivalent Deluxe; if none free, **auto-refund via `PaymentProvider.refund`** (not 06 — no folio exists, the booking never confirmed) and notify the guest — never overbook. (FR-8)
- **AC-8:** Given payment fails/abandoned or TTL elapses, then the hold is released via 03 (inventory returns), order → FAILED/EXPIRED, never confirmed. (FR-9)
- **AC-9:** Given a webhook with missing/invalid signature, then rejected `SIGNATURE_INVALID`, no side effects. (FR-6)
- **AC-10:** Given a duplicate webhook (same gatewayOrderId/provider event id), then deduped via inbox — idempotent, no double confirm. (FR-19)

## US-4 — Abuse, consent, policy
- **AC-11:** Given >N requests/min from an IP, when exceeded, then 429 with `Retry-After` and **no** hold/order side effects. (FR-10)
- **AC-12:** Given bot signals (captcha fail/honeypot/velocity), then rejected **before** any hold/order + audit of the attempt. (FR-11)
- **AC-13:** Given submission without DPDP consent + policy acceptance, then it cannot confirm; consent (version+timestamp) is recorded on the order. (FR-12)
- **AC-14:** Given dates violating config (LOS/lead-time/max rooms/occupancy), then rejected at validation; nothing persists. (FR-14)

## US-5 — Self-service & idempotency
- **AC-15:** Given a signed booking-reference link (no login), when opened, then the token is verified and status shown; cancellation allowed only within the 48h window → 03 cancel + 06 refund policy. (FR-16)
- **AC-16:** Given a double-tap reusing the same client idempotency key, then the original result returns — no second hold/order/reservation. (FR-22)
- **AC-17:** Given PAY sandbox (no live creds), when booking, then the full flow completes end-to-end (non-prod). (FR-18)
- **AC-18:** Assert the amount charged equals the displayed GST-inclusive total (no divergent client recompute). (FR-15)
- **AC-19:** Given a staff user without `bookingengine:manage`, when editing `BookingEngineConfig` (deposit/stay/cancel policy, gateway, publish), then `FORBIDDEN` (403); the public book/pay flow itself stays unauthenticated. (FR-17)
