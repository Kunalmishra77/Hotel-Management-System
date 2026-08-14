# Phase 2 — Customer product: guest accounts & booking

> Part of the customer-first redesign. Builds on Phase 1's `/` customer website.
> Introduces the system's first **guest account**. Security-critical: guest auth is
> fully isolated from staff auth and structurally cannot reach `/dashboard`.

## Goal

A guest, on our own website, can: create an account → browse rooms across our
published properties → pick dates & guests → book → choose **pay now / pay at hotel
/ partial** → get confirmation + GST invoice → see it under **My Bookings** → cancel
or modify within policy. The booking becomes a real reservation (the hotel-side
bridge + notifications are Phase 3).

## Auth model (decided)

Two login paths, both landing on one CRM `Guest` (deduped by phone/email via the
existing `upsertPublicGuest` / dedupe logic — the hotel sees **one** guest):

- **Phone path (unified signup+login).** Enter phone → 6-digit OTP → verify →
  find-or-create `GuestAccount` (+ `Guest`) → guest session. New phone = new account,
  known phone = login. (Swiggy/MakeMyTrip style.)
- **Email path (explicit).** Sign-up = name + email + password + phone; login =
  email + password. bcrypt cost ≥ 12 (reuses `lib/auth/password.ts`).

**Isolation:** guest sessions are their own DB-backed, revocable table + their own
httpOnly cookie — never Auth.js, never `Session`, never a role/permission. Guest
routes live under `/account/*` and `/book/*`; the dashboard middleware gate is
unchanged, so a guest cookie grants nothing inside `(dashboard)`.

## Data model (this task)

Three new tables (additive migration; owns nothing existing):

- **`GuestAccount`** — `orgId`, `guestId` (link), encrypted `email`/`emailHash`,
  encrypted `mobile`/`mobileHash` (required), `passwordHash?` (null = phone-only),
  `emailVerifiedAt?`, `phoneVerifiedAt?`, `isActive`, `failedLoginCount`,
  `lockedUntil?`, `lastLoginAt?`, timestamps + `deletedAt`.
  Unique `(orgId, mobileHash)` and `(orgId, emailHash)` — one account per contact.
- **`GuestSession`** — mirrors staff `Session`: `tokenHash @unique`, `expiresAt`,
  `revokedAt?`, `ip?`, `device?`. sha256(token) stored, random token in the cookie.
- **`GuestOtp`** — `orgId`, `mobileHash`, `codeHash` (sha256 of the 6-digit code),
  `purpose`, `expiresAt`, `consumedAt?`, `attempts`. 10-min expiry, ≤5 attempts,
  resend cooldown; delivered via the messaging provider (sandbox → outbox, so the
  demo works with zero external accounts; real SMS at go-live).

## Tasks

- [ ] **T-1 — Data model.** Add the three models + back-relations (Organization,
  Guest). `prisma migrate` (additive). `prisma generate` + `typecheck` green. *(this turn)*
- [ ] **T-2 — Guest-auth infra.** `lib/guest-auth/`: token mint/hash (reuse the
  session-token pattern), guest cookie get/set/clear, `resolveGuestSession()`
  (DB-backed, checks `revokedAt`/`expiresAt`), OTP generate/verify domain (pure,
  unit-tested), rate-limit + lockout helpers.
- [ ] **T-3 — Guest-auth actions** (`features/guest-account/actions.ts`): `signUpEmail`,
  `logInEmail`, `requestPhoneOtp`, `verifyPhoneOtp`, `logOut`. Each: zod-validate →
  (rate-limit) → work → audit (no PII/secret in logs) → typed Result. find-or-create
  Guest link. Integration-tested incl. lockout, OTP expiry/attempts, session isolation.
- [ ] **T-4 — Guest area shell + auth pages.** `/account/sign-in` (email + phone tabs),
  `/account/sign-up`, `/account` layout (guest session required → else redirect),
  header account menu. Middleware: `/account` public only for the auth pages; inner
  pages gate on the guest session server-side.
- [ ] **T-5 — Booking flow (signed-in).** Wrap the existing booking engine: choose
  property → dates/guests → room → **pay now / at hotel / partial** (via existing
  `PaymentProvider`, sandbox) → confirm. Reuses availability (one truth) + GST-incl
  pricing + deposit policy. A signed-in guest's details prefill.
- [ ] **T-6 — My Bookings.** `/account/bookings` list + detail (status, folio,
  invoice download) + cancel/modify within the property window (reuses booking-engine
  self-service cancel + reservation modify; audited, event-emitting).
- [ ] **T-7 — Tests + build.** Unit (OTP, token, dedupe-link), integration (each
  action + RBAC/isolation negatives: guest cookie → 403/redirect on dashboard),
  `typecheck` + `lint` + `build` green.

## Security / DoD notes

- bcrypt ≥ 12; OTP codes stored only as sha256; tokens stored only as sha256.
- Deny-by-default: no guest permission exists; guest actions never call staff
  `authorize()` and never touch property-scoped staff data beyond their own bookings.
- PII: email/phone encrypted at rest + `*Hash` for lookup (mirrors `Guest`). No PII
  or OTP code in logs. Guest can export/erase later (DPDP) — hook noted, not built here.
- Every guest mutation writes an audit record + emits a domain event where one exists.

## Out of scope (later)

- Hotel-side booking bridge + notifications (Phase 3). In-room portal (Phase 4).
- Real SMS/email delivery + live payment gateway (Phase 8 / client go-live).
