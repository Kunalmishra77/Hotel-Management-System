# Wave A1 — Rich booking + confirmations

> Guest-journey completeness, wave 1. The booking flow today shows a room name + a
> price. Leaders (MEWS/Cloudbeds/Booking.com) show photos, amenities, a clear
> cancellation policy, and send a confirmation. This wave closes that gap — the
> "OTA-grade booking feel" — reusing the booking-engine backend (availability,
> pricing, coupon, deposit) that's already there.

## Scope (this wave)

- **Rich room cards** — `RoomCategory` gains `imageUrls`, `description`,
  `amenities`; the availability API returns them; both booking UIs (public
  `BookingWidget` + signed-in `GuestBooking`) render a photo, description, and an
  amenity list. Graceful placeholder when no image.
- **Coupon input** — the coupon engine already exists server-side (`placeHold` /
  `createGuestBooking` accept `couponCode`, atomic redemption); expose an input in
  the signed-in booking flow and pass it through; the confirmed total reflects it.
- **Cancellation policy display** — show "Free cancellation until <date>" from the
  property's `cancelWindowHours` at the confirm step.
- **Booking confirmation** — verify the already-seeded `BOOKING_CONFIRMATION`
  template + automation (on `ReservationCreated`) fires for a guest booking
  (sandbox outbox; live send needs BSP).

## Explicitly deferred (later waves — bigger)

- **Multiple rate plans** (room-only / breakfast / non-refundable) — a real pricing
  change (booking engine prices from base + dynamic rate, not `RatePlan`); its own
  wave.
- **Add-ons at booking** — belongs to the **upsell engine** (Wave A3).
- **Scarcity/urgency, OTA rate-comparison, abandonment recovery** — later.

## Tasks

- [ ] **T-1** — `RoomCategory.imageUrls String[]`, `description String?`,
  `amenities String[]` + additive migration; seed demo values on PROP_A categories.
- [ ] **T-2** — `getPublicAvailability` selects + returns
  `imageUrls/description/amenities` per `AvailabilityCategory`.
- [ ] **T-3** — Room cards render a photo (first `imageUrl`, placeholder fallback),
  description, and amenity chips, in `BookingWidget` + `GuestBooking`. Mobile-first.
- [ ] **T-4** — Coupon field in `GuestBooking` confirm step → `createGuestBooking`
  (already accepts `couponCode`); "Free cancellation until <date>" line.
- [ ] **T-5** — Confirm the `BOOKING_CONFIRMATION` automation is wired (a WEBSITE
  `ReservationCreated` enqueues the message); note sandbox vs live.
- [ ] **T-6** — Unit (any pure helper) + integration (availability returns the new
  fields; booking with a coupon lowers the total) + typecheck + lint + build; local DB.

## DoD
- No overbooking / pricing change — additive display fields + existing coupon path.
- Images are URLs (staff-config); empty → tasteful placeholder, never a broken img.
- GST-inclusive price still the one truth (unchanged).
