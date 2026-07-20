# 23 · Booking Engine — Design

## Schema slice
**Confirmed present in canonical schema** (migration materializes the slice; nothing new): `BookingEngineConfig(propertyId, slug, onlineSellableCategoryIds, depositPolicy[FULL|PCT|FIXED], depositValue, checkoutTtlMin, minLos, maxLos, leadTimeDays, maxRoomsPerBooking, cancelWindowHours, gatewayProvider, isPublished)`; `BookingEngineOrder(id, propertyId, reservationId, gatewayOrderId, amountPaise, status[CREATED|PAID|FAILED|EXPIRED], idempotencyKey, consentVersion, consentAt, createdAt)`. GST-inclusive display reads `RoomCategory.gstBps` (also in schema). Writes everything else through 03/04/06/00 public surfaces — **no foreign SELECTs**.

## Domain layer (pure) — `features/booking-engine/domain/`
- `depositAmount(totalPaise, policy): number` (FR-5).
- `validateStayConstraints(dates, occupancy, cfg): Result` (FR-14).
- `gstInclusiveDisplay(ratePaise, nights, gstBps): number` — `gstBps` sourced from `RoomCategory.gstBps` (FR-3/15).

## Application — public route handlers (`src/app/api/booking-engine/v1/[slug]/...`) + `features/booking-engine`
Public, unauthenticated, versioned, **rate-limited**, bot-protected (FR-1/10/11).
- `GET availability` → 03 `searchAvailability` + `24.resolvedRate({categoryId, date})` (no `negotiatedRatePaise` for public/anonymous; fallback base) + GST-inclusive price via `RoomCategory.gstBps`. (FR-3/18)
- `POST hold` → validate constraints + consent → 04 upsert guest → 03 `holdReservation` (TTL) → `depositAmount` → 06/`PaymentProvider` order → persist `BookingEngineOrder`. Idempotency key dedupes double-submit. (FR-4/5/12/22)
- Webhook `/api/webhooks/payments/{provider}` → verify signature → inbox dedupe → on success: `confirmReservation` (03) + advance `recordPayment` (06) + order PAID + `WebBookingConfirmed`; **if the hold is lost** → `03.reallocateRoom(reservationId)` (equivalent room, same category) else **auto-refund via `PaymentProvider.refund`** (no folio — 06 not involved) + `WebBookingFailed`; on fail/expire: release hold + order FAILED/EXPIRED. (FR-6/7/8/9/19)
- Staff config: `updateBookingEngineConfig(...)` / `publish()` — `bookingengine:manage` (🔒, audited). (FR-17)
- `GET/POST booking/{signedToken}` → verify token → status + windowed cancel (03 + 06 refund). (FR-16)
- Jobs (pg-boss): TTL sweeper releases expired holds. (FR-9)

## UI — wireframes (public, mobile-first)
```
┌───────────────────────────┐   ┌───────────────────────────┐
│ Woodpecker MG Road        │   │ Your details              │
│ In [12Jul] Out [15Jul]    │   │ Name  [__________]        │
│ Guests [2]  [Search]      │   │ Mobile[__________]        │
│ ── Deluxe ──              │   │ Email [__________]        │
│ ₹13,440 incl. GST · 3n    │   │ ☑ I accept terms + DPDP   │
│ 2 left    [Book]          │   │  Pay ₹2,688 deposit       │
└───────────────────────────┘   │        [Pay & confirm]    │
                                 └───────────────────────────┘
```
Confirmation page shows booking ref + signed self-service link. Failure page explains hold-lost + auto-refund.

## Events
Emits: `WebBookingConfirmed`, `WebBookingFailed`, `WebBookingCancelled`. Consumed by 14 (WEBSITE revenue/pace), 12 (confirmation). Catalog: `docs/architecture/domain-events.md`.

## Sequences
**Book & pay:** validate+consent → upsert guest (04) → hold (03, TTL) → create gateway order (06, sandbox if no creds) → return params. Guest pays → webhook (verify sig, inbox dedupe) → **one tx**: confirm (03) + advance (06) + order PAID + `WebBookingConfirmed`. Hold-lost path → `03.reallocateRoom` else `PaymentProvider.refund` + `WebBookingFailed`. Expiry/fail → release hold + order terminal.

## Error catalog
`RATE_LIMITED (429)`, `BOT_REJECTED`, `CONSTRAINT_VIOLATION`, `CONSENT_REQUIRED`, `SIGNATURE_INVALID`, `HOLD_EXPIRED`, `IDEMPOTENT_REPLAY`, `NOT_FOUND`.

## Edge cases
- Pay-after-hold-expiry → `03.reallocateRoom` (equivalent room, same category); with none free → `PaymentProvider.refund` auto-refund + notify (FR-8) — never overbook, never touches a folio (booking never confirmed).
- Webhook before order committed → inbox holds; processed once order exists.
- Double-tap → idempotency key returns original (FR-22).
- Missing dynamic rate → base-rate fallback; search never fails (FR-18).
- Public responses leak no other-guest PII / internal room numbers pre-confirmation (FR-20).
- Live payments blocked on client KYC — sandbox until then (FR-18).
