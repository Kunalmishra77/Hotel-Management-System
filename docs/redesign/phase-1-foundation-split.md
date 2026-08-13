# Phase 1 — Foundation Split (Customer website ↔ Staff portal)

> Part of the customer-first redesign. Design source: the architecture blueprint
> (validated 2026-08-13). Each phase stays demoable & explainable. This phase adds
> the **product boundary** the later phases build on; it removes no existing feature.

## Goal

Today the public root `/` is a **staff product pitch** (it markets the PMS to staff,
shows role portals, and redirects a signed-in staff user to `/dashboard`). There is
no distinct **customer** front door — guests only reach a single property's booking
page at `/book/[slug]`.

Phase 1 cleanly separates the **two products that share one brain**:

- **Customer website** (`/`) — a guest-facing brand home: browse the properties,
  start a stay search, book direct, and a place to sign in / sign up as a guest
  (the guest account itself lands in Phase 2). Public, unauthenticated.
- **Staff portal launcher** (`/portal`) — the internal product's front door: what the
  platform does, the role-based portals, and staff sign-in. Signed-in staff continue
  to land on `/dashboard`.

## Non-negotiables carried from the rules

- **No feature loss.** `/sign-in`, `/book/[slug]`, `/book/[slug]/manage`,
  `/order/[token]`, `/track/[token]`, `/dashboard`, and every existing module route
  keep working unchanged.
- **RBAC unchanged.** Phase 1 touches only public entry pages; no permission map,
  no server action, no query scoping changes. Hierarchy & role scopes are confirmed,
  not rewritten.
- **Multi-property.** The customer home lists only **published** booking sites of
  **active, non-deleted** properties (reuses the booking-engine publish gate).
- **No mock data.** The property grid is driven by real `BookingEngineConfig`
  rows (`isPublished = true`) joined to their live `Property`.
- **Mobile-first.** Base styles target the phone; enhance upward.

## Tasks

- [ ] **T-1 — `listPublishedSites()` query.** Add to
  `src/features/booking-engine/queries.ts`: return every published site (property
  name, slug, city, state) for active/non-deleted properties, ordered by name.
  Unauthenticated-safe (uses `bookingDb()`), no PII, bounded result.
- [ ] **T-2 — Customer website at `/`.** Replace `src/app/page.tsx` with a
  guest-facing home: brand hero + stay-search entry, a real "Our properties" grid
  (from T-1) linking each to `/book/[slug]`, "why book direct" value props,
  guest sign-in / sign-up entry (stub → Phase 2), and a footer with a discreet
  **Staff & owner login** link to `/portal`. A signed-in **staff** session still
  redirects to `/dashboard` (guests have no session yet).
- [ ] **T-3 — Staff portal launcher at `/portal`.** New `src/app/portal/page.tsx`
  carrying the current staff content: capabilities, the role-based portal showcase,
  and staff sign-in. Signed-in staff redirect to `/dashboard`.
- [ ] **T-4 — Wire & verify.** Ensure sign-in "back" affordances and any `/` links
  used by staff still make sense; confirm the five public/authless routes above are
  untouched; `typecheck` + `lint` + `build` green.

## Acceptance

1. Visiting `/` as an anonymous user shows the **customer** website (not the staff
   pitch); "Book a stay" reaches a published property's `/book/[slug]`.
2. Visiting `/portal` shows the staff launcher (role portals + staff sign-in).
3. A signed-in staff user hitting `/` or `/portal` is redirected to `/dashboard`.
4. No previously reachable route 404s or loses functionality.
5. `npm run typecheck`, `npm run lint`, `npm run build` pass.

## Out of scope (later phases)

- Guest account auth, guest dashboard, "My bookings", the full browse→pay flow (Phase 2).
- Booking→reception bridge + notifications (Phase 3). In-room portal (Phase 4).
