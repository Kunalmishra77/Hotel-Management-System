# 19 · POS — Design

## Schema slice (from canonical `prisma/schema.prisma`)
Owns `PosOrder`, `PosOrderItem`. **Confirmed present in canonical schema:** `MenuItem(id, propertyId, outletId, name, ratePaise, hsnSac, gstBps, isActive)`, `PosOutlet(id, propertyId, name, defaultGstBps)`, and the settlement/preview columns on `PosOrder` (`reservationId?`, `settledAt`, `settledById`, `settlementInvoiceId?`, `settlementPaymentId?`, `subtotal/discount/cgst/sgst/igst/roundOff/totalPaise`) — migration materializes the slice, nothing new. `PosOrder` carries `@@unique([propertyId, code])` (gap-free order/KOT number, allocated from a per-property transactional counter) + `@@index([propertyId, status])`. POS holds only order data; **06 owns all money rows**.

## Domain layer (pure, shares 06's tax) — `features/pos/domain/`
- `orderTotal(items): { subtotalPaise }` — derived (FR-2).
- `billPreview(items, discountPaise, propertyState): { subtotal, discount, cgst, sgst, igst, roundOff, total }` — uses the **same** `lib/tax` split as 06 (FR-3/4). Place of supply is **not a caller argument**: POS is on-premise, so it is pinned internally to `propertyState` via 06's `placeOfSupply(POS, …)` helper → `igst` is always `0` and the split is always CGST+SGST (§10). The `igst` key stays in the return shape only so POS and 06 share one bill type. (FR-4)
- `canTransition(from, to)` — OPEN→SETTLED→VOID state machine (FR-10).

## Application — server actions (`features/pos/actions.ts`)
Per `api-conventions.md`. Money via 06's public actions only.
- `createOrder(outletId, reservationId?)` / `addItem` / `removeItem` — OPEN only; recompute preview. (FR-1/2/3)
- `applyDiscount(orderId, amountPaise, reason)` — threshold + `folio:discount`. (FR-15)
- `sendToKitchen(orderId)` — KOT; no settle. (FR-13)
- `settleToFolio(orderId)` — validate IN_HOUSE → `billing.ensureFolio(reservationId)` (idempotent; returns the open `folioId`) → `billing.postFolioCharge(folioId, …)` → SETTLED + `PosOrderSettled`. Row-locked status (concurrency). (FR-5/7/8/18)
- `settleDirect(orderId, tenders)` — folio-less path: `billing.settlePosSaleDirect()` (06 uses `ensureDirectSaleFolio(propertyId)` → `Folio(reservationId=null, kind=DIRECT_SALE)`) → store `invoiceId`/`paymentId` refs → SETTLED. (FR-6)
- `voidOrder(orderId, reason)` — `pos:order-void`; folio path calls `billing.reverseFolioLine(lineId, reason)`, direct path a 06 credit note; VOID + `PosOrderVoided`. (FR-11)
- Query `unsettledOrders(reservationId)` for checkout gate. (FR-17)

## UI — wireframes (mobile-first, `features/pos/components/`)
```
┌───────────────────────────┐
│ Restaurant · Table/Room ▾ │
│ Masala Dosa  ×2     240   │
│ Coffee       ×1      60   │
│ Subtotal            300   │
│ GST 5%               15   │
│ Round off            +0   │
│ Total              ₹315   │
│ [KOT] [Settle → folio]    │
│       [Settle direct]     │
└───────────────────────────┘
```
Menu grid (tap to add), quantity steppers, one-thumb settle. Kitchen view = aggregated prep list.

## Events
Emits: `PosOrderSettled` (`{propertyId, outlet, items}`), `PosOrderVoided`. Consumes: none (money events come from 06). Catalog: `docs/architecture/domain-events.md`.

## Sequences
**Settle to folio:** validate reservation IN_HOUSE → `billing.ensureFolio(reservationId)` (idempotent → open `folioId`) → row-lock the order row (`SELECT … FOR UPDATE` on `PosOrder` while it is `OPEN` — "SETTLING" is this in-tx lock window, **not** a new `status` enum value; enum stays `OPEN|SETTLED|VOID`) → `billing.postFolioCharge(folioId, {POS line, taxable, gst, hsn})` → set `SETTLED` + refs → emit `PosOrderSettled` → 20 consumes for stock. **Void:** authorize → `billing.reverseFolioLine(lineId, reason)` (folio path) / 06 credit note (direct path) → VOID + event.

## Error catalog
`FOLIO_TARGET_INVALID`, `ORDER_NOT_OPEN`, `ILLEGAL_TRANSITION`, `DISCOUNT_OVER_THRESHOLD`, `VALIDATION_FAILED`, `FORBIDDEN`.

## Edge cases
- Concurrent settle → row lock; one wins (FR-18).
- In-house guest checks out with an open POS order → surfaced by `unsettledOrders`; 06 balance gate blocks checkout (FR-17).
- Discount + GST interplay → discount is a negative line before tax per the shared bill fn.
- Out of scope (open questions): table management, KDS hardware, thermal-printer drivers, offline capture, dynamic menu pricing.

---

## Addendum 2026-08-08 — guest in-room QR ordering + kitchen ticket lifecycle

**Principle:** reuse everything money. Guest **accept** posts through the existing tested `settleToFolio` (FR-5). The only new money-adjacent construct is a `REQUESTED` staff-gate *in front of* it. The public QR surface touches no money and no PII.

### Schema slice (migration)
- `PosOrderStatus` += `REQUESTED` (guest-submitted, pending staff accept). Lifecycle: `REQUESTED → OPEN → SETTLED` (accept path) or `REQUESTED → VOID` (reject).
- `PosOrder` += `source (STAFF|GUEST_QR)`, `guestNote String?`.
- `PosOutlet.isRoomDining Boolean @default(false)` — designates the outlet a room QR orders from. Resolution: the property's `isRoomDining` outlet; else the sole outlet if only one exists; else ordering is unavailable until staff flag one.
- `Room.orderToken String? @unique` — 02 owns the column (coordinated migration); 19 reads it via 02's query layer. A stable, unguessable per-room secret (e.g. `cuid()`), stamped once, printed as the room's QR.
- `KitchenTicket(id, orderId @unique, propertyId, outletId, status KitchenTicketStatus, queuedAt, startedAt?, readyAt?, servedAt?)`; `enum KitchenTicketStatus { QUEUED, PREPARING, READY, SERVED }`.

### Domain
- `canAdvanceTicket(from, to)` — `QUEUED→PREPARING→READY→SERVED`, forward-only, no skips. Pure, unit-tested.
- Guest submission reuses `orderTotal`/`billPreview` (server-priced from `MenuItem`; client prices are ignored — FR-2/21).

### Public surface (unauthenticated) — `src/app/(public)/order/[token]/`
Mirrors the booking-engine's public-route + rate-limit posture. `page.tsx` resolves `token → room → property → configured room-dining outlet`, applies the **occupied-gate** (in-house reservation required), renders **menu only** (prices + "added to your room bill"), and posts via a token-verified public action `submitGuestOrder(token, lines[], note?)`. No session, no PII, rate-limited; unknown token / unoccupied room → one generic unavailable response.

### Application (staff, authorized) — `features/pos/`
- `acceptGuestOrder(orderId)` (`pos:order-create`): `REQUESTED→OPEN` → `sendToKitchen` (creates `KitchenTicket`) → `settleToFolio` (existing) → audit. Row-locked like settle (FR-18-style), so two accepts can't double-post.
- `rejectGuestOrder(orderId, reason)` (`pos:order-void`): `REQUESTED→VOID`, nothing charged, `PosOrderVoided` + audit.
- `startTicket/readyTicket/serveTicket(ticketId)` (`pos:order-create`): advance the ticket, audit, emit `KitchenTicketMoved`.
- Queries: `roomOrderInbox(propertyId)` (REQUESTED orders) and the existing `kitchenPrep`, now backed by `KitchenTicket` status.

### UI
- **Guest page** (public): single-outlet menu grid, cart, submit + note. Deliberately minimal, no auth chrome.
- **Room-orders inbox** (staff, on the POS screen): live list of REQUESTED orders with Accept/Reject; subscribes via `useRealtime`.
- **Kitchen screen**: per-ticket Start / Ready / Served; live via `useRealtime`.
- **Room detail page** (02): renders + prints the room's QR (qrcode lib — see ADR `docs/architecture/adr/`).

### Events & realtime
Emits `GuestOrderRequested` (propertyId, aggregateId=orderId), `KitchenTicketMoved` (propertyId, aggregateId=ticketId), plus the existing `PosOrderSettled`/`PosOrderVoided` on accept/reject. `GuestOrderRequested` + `KitchenTicketMoved` are added to the SSE broadcast allow-list (property-scoped, payload-stripped) so the inbox + kitchen update live (17 FR-5).

### Error catalog (additions)
`ROOM_NOT_AVAILABLE` (occupied-gate / bad token — generic), `ORDER_NOT_REQUESTED` (accept/reject on a non-REQUESTED order), `ILLEGAL_TICKET_TRANSITION`, plus rate-limit rejection.

### Security
Public endpoint: token-verified, occupied-gated, rate-limited, menu-only, audit actor = a `guest-qr` system context. Accept/reject/kitchen are ordinary authorized+audited staff actions. A guest can never settle, void, discount, see another room's data, or reach an authenticated route.
