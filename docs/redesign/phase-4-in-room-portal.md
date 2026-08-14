# Phase 4 — In-room guest portal

> Part of the customer-first redesign. Once a guest is **checked in**, their account
> becomes an in-room concierge: see the stay + bill, order food, request service,
> and track each request — every request notifying the hotel (Phase 3). Reuses
> Phase 2 (guest auth), Phase 3 (notifications), the folio, and the existing POS
> room-dining QR flow.

## What already exists (reused, not rebuilt)

- **Active stay** = the guest's own reservation where `status = IN_HOUSE`; its room
  comes from `RoomAllocation`, its bill from the reservation's `Folio`
  (`folioBalance(lines, payments)` is pure and canonical).
- **Food ordering** — every room already has a POS `orderToken`; the tested
  `/order/{token}` room-dining flow (staff-accept → settle-to-folio) is reused
  verbatim. The portal just links the guest's own room there.
- **Notifications** (Phase 3) — a new `GuestRequestCreated` event routes to the
  right staff via the same permission-matrix targeting.

## The gap this closes

No way for a checked-in guest to reach the hotel from their phone. Phase 4 adds a
**`GuestRequest`** (one model the guest submits and tracks across housekeeping /
maintenance / amenity / other) and the in-room surfaces.

## Design

**`GuestRequest` (new).** `orgId`, `propertyId`, `reservationId`, `roomId?`,
`guestId`, `kind` (HOUSEKEEPING | MAINTENANCE | AMENITY | OTHER), `detail`,
`status` (OPEN → ACKNOWLEDGED → IN_PROGRESS → DONE / DECLINED), timestamps,
`resolvedAt?`. Guest-owned (submit + track); staff triage from a reception inbox.

**Submit flow.** The guest's active IN_HOUSE reservation is resolved from the
session (never a client id). `createGuestRequest` validates, writes the row +
emits `GuestRequestCreated` + audit (system context), returns a Result.

**Notify.** The notifications consumer, on `GuestRequestCreated`, notifies **the
department** for the kind (HOUSEKEEPING→`housekeeping:update`,
MAINTENANCE→`maintenance:manage`) **and reception** (`reservation:view`, the
front-desk hub), each linking to `/requests`.

**Close the loop.** A reception **requests inbox** (`/requests`, `reservation:view`)
lists active requests with a status-advance action; the guest sees the new status
in their tracker. (Department staff also action the physical task on their own
boards — deeper board integration is a follow-up.)

## Tasks

- [ ] **T-1 — model + event.** `GuestRequest` + additive migration;
  `GuestRequestCreated` in the event catalog + doc.
- [ ] **T-2 — guest reads + actions.** `getActiveStay` (reservation + room + folio
  summary, scoped to the session guest), `createGuestRequest`, `listMyRequests`.
  Pure status-label/kind helpers unit-tested.
- [ ] **T-3 — notifications.** Consumer handles `GuestRequestCreated`; generalise
  the recipient resolver to `usersWithPermission(orgId, propertyId, permission)`;
  notify department + reception.
- [ ] **T-4 — guest UI.** `/account/stay` (room, checkout, folio charges + balance,
  “Order food” → `/order/{orderToken}`, request form, my-requests tracker); surface
  an active-stay card on `/account`.
- [ ] **T-5 — staff inbox.** `/requests` list + `updateGuestRequestStatus`
  (`reservation:view`, property-scoped, audited) + a nav item.
- [ ] **T-6 — verify.** Unit + integration (create scoped to the guest's own stay;
  IDOR: can't request against another's stay; consumer notifies the right roles;
  staff status update authorized) + typecheck + lint + build; local-DB run.

## Security / DoD

- Guest can only act on **their own** active stay (reservation resolved from the
  session, `guestId` match); `listMyRequests` and the tracker are self-scoped.
- Staff status update is permission-checked + property-scoped + audited.
- Guest requests carry no other-guest PII; folio view is the guest's own.

## Out of scope (later)

- Extend-stay, in-app chat, pay-from-portal (folio is view-only; payment stays at
  the desk per MoM). Auto-creating HousekeepingTask/MaintenanceJob from a request.
