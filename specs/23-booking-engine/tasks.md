# 23 · Booking Engine — Tasks

Public + payment + no-overbooking. Test-first for domain; security tests for public surface. Each ends at `rules/definition-of-done.md`. `(AC-n)/(FR-n)`.

## Schema & migration
- [ ] T-1 `BookingEngineConfig`, `BookingEngineOrder`, and `RoomCategory.gstBps` are **confirmed present in canonical schema**; migration materializes the slice + indexes; `Reservation` source WEBSITE reused. (FR-1/5)
- [ ] T-2 Seed fixtures (CFG, sellable CAT-DLX, sandbox gateway).

## Domain (write tests first)
- [ ] T-3 `depositAmount` (full/pct/fixed). (FR-5, AC-5)
- [ ] T-4 `validateStayConstraints` (LOS/lead-time/max rooms/occupancy). (FR-14, AC-14)
- [ ] T-5 `gstInclusiveDisplay` (gstBps from `RoomCategory.gstBps`) = charged total. (FR-15, AC-18)

## Public surface (integration + security tests)
- [ ] T-6 `GET availability`: sellable-only, GST-inclusive (`RoomCategory.gstBps`), via 03 truth; `24.resolvedRate` + base fallback. (FR-2/3/18, AC-1/2/3)
- [ ] T-7 Rate limiting per IP+route → 429 + no side effects. (FR-10, AC-11)
- [ ] T-8 Bot/abuse rejection before hold/order + audit. (FR-11, AC-12)
- [ ] T-9 `POST hold`: constraints + consent + 04 upsert + 03 hold + gateway order + `BookingEngineOrder`. (FR-4/5/12, AC-4/5/13)
- [ ] T-10 Idempotency key dedupes double-submit. (FR-22, AC-16)

## Payment webhook & confirmation (integration tests)
- [ ] T-11 Signature verify + inbox dedupe. (FR-6/19, AC-9/10)
- [ ] T-12 Success → confirm(03)+advance(06)+PAID+`WebBookingConfirmed`+12. (FR-7/21, AC-6)
- [ ] T-13 Success-but-hold-lost → `03.reallocateRoom` else `PaymentProvider.refund` auto-refund (not 06); never overbook. (FR-8, AC-7)
- [ ] T-14 Fail/abandon/TTL → release hold + terminal order. (FR-9, AC-8)
- [ ] T-15 Sandbox gateway completes end-to-end. (FR-18, AC-17)

## Self-service
- [ ] T-16 Signed-link status + windowed cancel → 03 cancel + 06 refund. (FR-16, AC-15)
- [ ] T-17 Public responses expose no other-guest PII / internal room numbers. (FR-20, AC-2)
- [ ] T-17b Staff `BookingEngineConfig` edit/publish gated on `bookingengine:manage` (🔒, audited); public flow stays unauthenticated. (FR-17, AC-19)
- [ ] T-17c Coupon at checkout: `06.validateCoupon` preview (recompute total+deposit, no consume); `06.applyCoupon({reservationId})` inside the confirm tx (redeem once); abandoned checkout redeems nothing; invalid coupon → reason + proceed without. (FR-23/24, AC-20)

## UI (public, mobile-first)
- [ ] T-18 Search + results (GST-inclusive). (AC-1)
- [ ] T-19 Checkout (details + consent + pay); confirmation + failure pages. (AC-4/6/13)

## E2E
- [ ] T-20 Journey: search → book → sandbox pay webhook → CONFIRMED WEBSITE reservation + advance in 06 + confirmation queued; concurrent last-room does not overbook. (AC-1/4/6/7)

## Done
- [ ] T-21 `/review-module` clean; every AC → green test; no-overbooking verified; DoD satisfied.
