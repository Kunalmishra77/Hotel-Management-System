# Wave 3 — Add-ons / Upsell engine

**Goal:** a guest with an upcoming or in-house booking can request paid extras
(airport pickup, extra bed, breakfast, early check-in, late checkout); reception
accepts, and on accept the priced, GST-correct charge posts to the reservation's
folio (no guest payment — settle-to-folio). Closes the blueprint's 0%-today upsell gap.

**Guest journey stage:** pre-arrival → in-stay revenue (the OTA/MEWS "extras" upsell).

## Design — reuse, don't reinvent

- **Money:** never write a `FolioLine`. Call `billing/charge-actions.postFolioCharge`
  (self-contained: own auth `folio:charge`, GST/HSN/place-of-supply, own tx, emits
  `FolioCharged` + audit). Get/ensure the folio via `billing.ensureFolio`.
- **On-premise GST:** all add-on charge types (`AIRPORT_TRANSFER`, `EXTRA_BED`, `FOOD`,
  `MISC`) resolve place-of-supply to the property's own state → always CGST+SGST.
  `postFolioCharge` computes it; we pass `type` (+ optional `taxRateBps`).
- **Guest-submit → staff-accept:** mirror `guest-account/stay-actions.createGuestRequest`
  (guest creates pending, session-scoped) + `guest-requests/actions.updateGuestRequestStatus`
  (staff advances, forward-only, audited). On the ACCEPT transition, call `postFolioCharge`
  exactly as `pos/settle-actions.settleToFolio` does.
- **Gating:** request allowed when reservation ∈ {CONFIRMED, IN_HOUSE}; the folio charge
  posts only when IN_HOUSE (a folio exists / stay is active — same rule as POS settle).
- **RBAC:** reuse `folio:charge` for accept/decline (money-adjacent), `reservation:view`
  for the inbox — **zero rbac-matrix churn** (Reception/Manager/Asst-Mgr/Accounts/Admin
  already hold both). Guest create needs a guest session, no staff permission.
- **Price snapshot:** an `AddOnRequest` snapshots name/unitPaise/chargeType at request time,
  so later catalog edits never change a placed request or its posted charge.

## Tasks

- **T-1 Model + migration.** `prisma/schema.prisma`:
  - `enum AddOnRequestStatus { REQUESTED, ACCEPTED, DECLINED }`
  - `model AddOn` (per-property catalog): `id, propertyId, name, description?, pricePaise Int,`
    `chargeType ChargeType, hsnSac String?, taxRateBps Int?, active Boolean=true, sortOrder Int=0,`
    `createdAt, updatedAt`. `@@index([propertyId, active])`.
  - `model AddOnRequest`: `id, orgId, propertyId, reservationId, guestId, addOnId,`
    `nameSnapshot, unitPaise Int, quantity Int=1, chargeType ChargeType, note String?,`
    `status AddOnRequestStatus=REQUESTED, folioLineId String?, requestedAt=now,`
    `decidedById String?, decidedAt DateTime?`. Indexes `([propertyId, status])`, `([reservationId])`.
  - Back-relations on `Property`, `Reservation`, `Guest`, `AddOn`. FKs `Restrict` (money/guest data).
  - Migration additive; **strip the trgm GIN DROP INDEX lines** Prisma re-proposes.

- **T-2 Pure domain** `src/features/add-ons/domain/upsell.ts`:
  - `canRequestAddOn(status)` → `CONFIRMED | IN_HOUSE`.
  - `canPostAddOnCharge(status)` → `IN_HOUSE` only.
  - `ADDON_REQUEST_NEXT: Record<string,string[]>` — `REQUESTED → [ACCEPTED, DECLINED]`, terminal else.

- **T-3 Queries** `src/features/add-ons/queries.ts`:
  - `listActiveAddOns(propertyId)` — active catalog, ordered by sortOrder (public surface for the guest action + UI).
  - `getAddOn(addOnId)` — one catalog item (id, propertyId, name, pricePaise, chargeType, hsnSac, taxRateBps, active).
  - `listPendingAddOnRequests(user)` — staff inbox: REQUESTED rows across the user's property scope, joined to reservation (guest name, code, status) + add-on name. `reservation:view`.

- **T-4 Guest request** `src/features/guest-account/`:
  - `schema.ts`: `requestAddOnSchema = { addOnId, quantity(1..10)=1, note?≤300 }`.
  - `upsell-actions.ts`: `requestAddOn(raw)` — resolveGuestSession → the guest's OWN reservation
    (findFirst by `{ guestId, id }` from a `reservationId` in schema — IDOR-safe) with status in
    {CONFIRMED, IN_HOUSE} else DomainError; load the catalog item via `add-ons/queries.getAddOn`
    (must be same property + active); snapshot name/unitPaise/chargeType; create `AddOnRequest`
    (status REQUESTED) + emit `AddOnRequested` + audit in `runWithSystemContext(orgId)`.
  - `queries.ts`: `listBookingAddOns(principal, reservationId)` → `{ available: catalog[], mine: request[] }`
    scoped to the guest's own booking; used by the booking-detail component.

- **T-5 Staff decide** `src/features/add-ons/actions.ts`:
  - `decideAddOnRequest(id, decision: "ACCEPT" | "DECLINE")` — requireUser; load request + reservation
    status/propertyId; `authorize(folio:charge)`; validate transition via `ADDON_REQUEST_NEXT`.
  - **DECLINE:** CAS `REQUESTED→DECLINED` (updateMany guard) + emit `AddOnDeclined` + audit in context.
  - **ACCEPT:** require reservation IN_HOUSE (else `FOLIO_TARGET_INVALID` publicMessage "guest isn't
    checked in yet"); CAS-claim `REQUESTED→ACCEPTED` (updateMany guard; 0 rows → `CONFLICT`); then
    `ensureFolio` + `postFolioCharge({ folioId, type: chargeType, description: "Add-on: <name>",`
    `unitPaise, quantity, hsnSac?, taxRateBps? })`; on success finalize `folioLineId, decidedBy/At`
    + emit `AddOnAccepted` + audit in context; **on charge failure revert `ACCEPTED→REQUESTED`** (compensate).

- **T-6 Events** `src/lib/events/catalog.ts`: add `AddOnRequested`, `AddOnAccepted`, `AddOnDeclined`
  to `DOMAIN_EVENT_TYPES` (catalog is authoritative — emitEvent won't compile otherwise).

- **T-7 UI.**
  - Guest: `src/features/guest-account/components/booking-add-ons.tsx` — on `/account/bookings/[id]`,
    below the check-in block, when `canRequestAddOn(status)`: list available extras (name, price incl.
    GST-note, qty stepper, "Request") + the guest's own requests with a status pill
    (Requested / Added to your bill / Declined).
  - Staff: `src/app/(dashboard)/add-ons/page.tsx` + `src/features/add-ons/components/add-on-inbox.tsx`
    — pending requests (guest, booking code + status, item, amount), Accept/Decline; Accept disabled
    with "Awaiting check-in" when the booking is CONFIRMED (not yet IN_HOUSE). Add a sidebar nav entry.

- **T-8 Seed** `prisma/seed/`: an add-on catalog step for PROP_A — Airport pickup (AIRPORT_TRANSFER,
  ₹1,200, 5%), Extra bed (EXTRA_BED, ₹800, 12%), Breakfast per person (FOOD, ₹350, 5%),
  Early check-in (MISC, ₹1,000, 18%), Late checkout (MISC, ₹1,000, 18%). Idempotent upsert. Base
  fixture (not gated behind SEED_DEMO) so tests + the app both have a catalog.

- **T-9 Verify.**
  - Unit: `canRequestAddOn` / `canPostAddOnCharge` / `ADDON_REQUEST_NEXT`.
  - Integration: guest request scoped/IDOR (foreign booking → error); request on CHECKED_OUT → refused;
    accept on IN_HOUSE posts a folio line with correct type + CGST+SGST split and links `folioLineId`;
    accept on CONFIRMED → `FOLIO_TARGET_INVALID` (no charge); decline → DECLINED + no folio line;
    double-accept race → second gets CONFLICT (one charge only); RBAC: a housekeeping user → 403.
  - `tsc` + `eslint` + `vitest` (unit + this integration file on local DB) + `npm run build`. Commit to branch.

## Known limits (documented, not bugs)
- A pre-arrival request (CONFIRMED) can't be charged until the guest is IN_HOUSE; it stays REQUESTED
  and becomes acceptable at check-in. A future increment: auto-apply accepted-but-deferred add-ons at
  check-in, and an admin CRUD screen for the catalog (this wave seeds it). Room-upgrade upsell (a rate
  delta, not a flat fee) is intentionally out of this wave — it belongs with rate resolution.
