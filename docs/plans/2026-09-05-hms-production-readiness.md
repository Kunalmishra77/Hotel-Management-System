# Woodpecker PMS — Production-Readiness Plan (A-Z)

**Date:** 2026-09-05 · **Owner:** Reception/Front-desk + Super-Admin flows
**Rule:** build one phase at a time — implement → test → review → next. No big-bang.

This plan is grounded in a full code audit (Sept 2026) of the affected modules.
Each phase lists what already exists so we don't rebuild, and what's actually missing.

---

## Audit summary (what's really there)

| Area | State today | Key files |
|---|---|---|
| Check-in wizard | EXISTS (Verify→Identity→FormC→Register→Payment→Confirm) | `features/reservations/components/check-in-wizard.tsx`, `lifecycle-actions.ts:108` |
| Edit guest info | Action `updateGuest` EXISTS but **orphaned** (no UI), missing dob/age/address/nationality/occupation | `features/guests/actions.ts:141` |
| Edit after check-in | **Blocked** — `modifyReservation` hard-gated to `CONFIRMED` | `features/reservations/move-actions.ts:52` |
| Accompanying guests | **MISSING** — 1 booking = 1 guest, no model | `schema.prisma` Reservation:547 |
| Extra bed / occupancy after booking | **MISSING** — frozen at booking | `booking-form.tsx`, `lifecycle-actions.ts:161` |
| Folio charges / discounts | EXISTS (`postFolioCharge`, `applyDiscount`, coupons) | `features/billing/charge-actions.ts:29,82` |
| Post-booking rate change | **MISSING** — `ratePaise` immutable after create | `features/reservations/booking.ts:144` |
| Balance auto-recalc | EXISTS (derived, never stored) | `features/billing/domain/balance.ts:19` |
| Reception add-on/upsell | PARTIAL — guest-initiated only, no reception "add" | `features/add-ons/actions.ts:28` |
| Billing list | Shows **invoices only**; folios/paid check-ins invisible | `app/(dashboard)/billing/page.tsx:52` |
| Invoice generation | **Only manual** (folio button); never auto at check-in/checkout | `features/billing/invoice-actions.ts` |
| Super-Admin Bookings | **MISSING** (no portfolio bookings section) | `portals.ts:51`, `insights/page.tsx` |
| Booking detail | Shows balance only; full detail one click away on folio | `bookings/[id]/page.tsx:38` |
| Subscription + Branding | EXISTS (to remove) | `portals.ts:54`, `navigation.ts:401-416` |
| Import/Export | Export buried in global search; import separate `/data-import`; rooms/services/master-data no export | `features/search/`, `features/data-onboarding/` |
| Data-onboarding (26) | EXISTS — CSV/Excel validate→commit→rollback | `features/data-onboarding/`, `ImportBatch` schema:383 |
| Photo/document historical entry | **MISSING** — object storage ready, no image→OCR→import bridge | `lib/storage`, `features/ai/passport-extract.ts` (mock) |

---

## Phases

### Phase 1 — Housekeeping quick wins  *(½ day, near-zero risk)*
**Goal:** clear the deck; make the panels reachable.
- Remove **Subscription** + **Branding** from Super-Admin: drop keys from `portals.ts:54`, remove `NAV_ITEMS` blocks `navigation.ts:401-416`, delete the two page dirs.
- Add **Bookings** + **Billing** nav entries to the SUPER_ADMIN portal (routes exist, just not wired for this portal).
- **Accept:** Super-Admin no longer sees Subscription/Branding; can open Bookings + Billing.

### Phase 2 — Billing correctness  *(the reported bug)*
**Goal:** every checked-in + paid stay is visible in Billing, with full money detail; GST invoice auto-issues at checkout.
- Billing page: add an **in-house / open-folios list** (folio, guest, charges, payments, balance) alongside the invoices table — so paid check-ins appear immediately (root cause: page reads `searchInvoices` only).
- **Auto-generate the GST invoice at checkout** (`lifecycle-actions.ts checkOut`), not just via the manual folio button — room-nights are posted at checkout, so this is the correct moment.
- Surface payment history + outstanding + tax + service/add-on charges on the billing views.
- **Accept:** check in → take payment → the stay shows in Billing with paid/pending; checkout → invoice exists automatically.

### Phase 3 — Editable inputs (guest + reservation)
**Goal:** correct any entered info anytime, incl. after check-in.
- Build a **guest edit UI** (profile edit sheet) reachable pre AND post check-in; wire the existing `updateGuest`.
- Extend `updateGuest` + `createGuestSchema` to cover **dob/age, nationality, occupation, full address, pincode, country** (currently dropped/never captured).
- Allow **reservation edits after check-in** (new/relaxed action) for safe fields (dates within rules, notes, occupancy) — audited.
- **Accept:** a wrong name/phone/ID/age can be fixed after check-in and persists; audit trail written.

### Phase 4 — Guest management (accompanying guests + occupancy)
**Goal:** add extra guests to an existing booking; adjust occupancy/extra beds.
- New schema model **`ReservationGuest`** (accompanying occupants: name, age, ID optional) + migration.
- UI + action to **add/edit/remove accompanying guests** on a booking (at booking, at check-in, after check-in).
- Post-booking **occupancy adjustment** (adults/children) + **extra-bed** that drives a folio charge (auto-recalc).
- **Accept:** a 1-guest booking can gain guests without a new booking; extra bed reflects in the bill.

### Phase 5 — Dynamic bill adjustments (pricing / discount / services)
**Goal:** staff change price up/down, discount, extra bed, add services — total recalculates live.
- **Rate override on a reservation** (audited, permission-gated) — currently `ratePaise` is immutable post-create.
- **Reception-initiated add-on/service** from the catalog (today only guests can request); fix the add-on HSN/tax-override bug (`add-ons/actions.ts:90`).
- One **"Adjust bill" panel** on the folio: change rate, apply discount, add extra bed/guest/service — each posts the correct line; balance (already derived) updates instantly.
- **Accept:** all adjustments post correct GST lines and the total is always correct.

### Phase 6 — Super-Admin Bookings & full Booking Details
**Goal:** portfolio bookings overview + a complete booking detail page.
- **Bookings section** for Super-Admin: total bookings across all properties + **property-wise** stats (bookings, cancellations, no-shows, occupancy, revenue).
- **Complete Booking Details page**: guest + stay + **room charges, folio lines, payment history, total, paid, pending, add-on charges, taxes** on one page (today it shows balance only, detail is on the folio).
- **Accept:** Super-Admin sees org-wide + per-property booking numbers and a full financial booking detail.

### Phase 7 — Import/Export hub redesign
**Goal:** one clear data console for import + export of every entity.
- Unified **Data hub** page: export per module (customers, bookings, rooms, services, billing, master data) + import in the same place.
- Add missing **export targets** (rooms, services, master data — today only search rows).
- Keep the module-26 validate→commit→rollback engine; just give it a coherent UI.
- **Accept:** any listed entity can be imported/exported from one obvious screen.

### Phase 8 — Data Entry (photo/document historical import)  *(needs a decision — see below)*
**Goal:** client photographs/uploads old booking registers, bills, service records → into the DB as real data.
- **Image/PDF upload → extract → `ImportBatch` rows → validate → commit** (reuse the module-26 pipeline + object storage; both already exist).
- Extraction path depends on the OCR decision below.
- **Accept:** a photographed record becomes reviewable, correctable structured data that commits to the DB.

### Phase 9 — A-Z portal/module review & polish  *(done last)*
**Goal:** sweep every portal/module for validation gaps, workflow holes, UX rough edges (per the "review each module last" rule). Turned into its own checklist after phases 1-8 land.

---

## Decisions (confirmed)
- **Execution order:** recommended order — Phase 1 → 2 → 3 … in sequence, each built → tested → reviewed before the next.
- **Data Entry (Phase 8) OCR approach:** **both** — every record's photo/PDF is always attached + stored; AI-assist auto-fills fields when a live vision provider is configured, otherwise staff type manually. The extracted/typed rows flow through the module-26 validate→commit pipeline.

## Notes / constraints carried
- Money stays integer paise / BigInt; balance is derived, never stored. GST for these Delhi properties = CGST+SGST (place-of-supply = property).
- Every mutation: validate → authorize → transaction → event → audit (no exceptions).
- Live demo data is the Hauz Khas seed; real data replaces it via Phases 7-8 after client approval.
