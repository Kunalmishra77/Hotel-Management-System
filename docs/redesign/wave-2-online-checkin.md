# Wave A2 — Online check-in + digital registration

> Guest-journey completeness, wave 2 — the single biggest gap. Today a guest is
> checked in by reception at the desk. Leaders (MEWS/Duve/Canary/Cloudbeds) let the
> guest do it from their phone **before arrival**: confirm details → e-sign the
> registration card → (later) upload ID → optional upsell/pre-auth. Adoption is
> 60–86%; front-desk time drops to <90s. This wave delivers the core, reusing the
> registration-card + e-signature + object-storage infrastructure already built for
> the staff check-in.

## Scope (this wave — the core)

- A guest, for their **own CONFIRMED upcoming** reservation (within a pre-arrival
  window), completes **online check-in**: confirm details (prefilled), set an
  **ETA**, add **special requests**, and **e-sign** a digital registration card.
- The signed card is stored exactly like the staff flow (signature PNG → encrypted
  object storage; the row keeps only the key + checksum + a server-built snapshot).
- The reservation is flagged `onlineCheckInAt`; reception sees **"Online check-in
  done ✓"** and confirms at arrival in one tap (existing wizard, pre-filled).

## Reused (not rebuilt)
- `RegistrationCard` model + `saveRegistrationCard`'s signature-storage pattern
  (`resolveStorageAdapter().put`), the `SignaturePad` component, the guest-account
  session + `getMyBooking`.

## Deferred (later)
- **ID / passport upload + AI OCR autofill** (guest-facing file upload + AI) — a
  focused Wave 2b (the staff side already has `extractPassportFields` + Form C to reuse).
- **Pre-arrival upsell + pre-auth** — belongs to the upsell wave (A3) + live payments.
- Digital key (hardware-blocked).

## Tasks
- [ ] **T-1** — `Reservation.onlineCheckInAt DateTime?` + additive migration.
- [ ] **T-2** — `submitOnlineCheckIn` guest action (session-gated to the caller's own
  CONFIRMED reservation within the window): store signature → upsert RegistrationCard
  (server-built snapshot, `capturedById = null`) → set `onlineCheckInAt` +
  `expectedArrival` + special requests → event + audit (system context).
- [ ] **T-3** — extend `getMyBooking`: `onlineCheckInAt`, `expectedArrival`, and an
  `onlineCheckInEligible` flag (CONFIRMED + checkIn within N days + not past).
- [ ] **T-4** — guest UI on `/account/bookings/[id]`: "Check in online" → a form
  (confirm details, ETA, special requests, `SignaturePad`) → submit → "Online
  check-in complete ✓".
- [ ] **T-5** — staff: an **"Online check-in done"** badge on the booking detail /
  reservation drawer so reception confirms faster.
- [ ] **T-6** — unit (eligibility helper) + integration (submit scoped to own
  reservation; IDOR-safe; card + flag created) + typecheck + lint + build; local DB.

## Security / DoD
- Guest can only online-check-in **their own** CONFIRMED reservation (resolved from
  the session, `guestId` match); a foreign/past/checked-in reservation is refused.
- Signature is PII → encrypted object storage; the DB keeps only key+checksum + a
  server-built snapshot (a tampered client payload can't forge the card).
- Emits `RegistrationCardCaptured` + audit.
