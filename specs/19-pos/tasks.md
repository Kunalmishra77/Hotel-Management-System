# 19 · POS — Tasks

Test-first for bill/tax + state machine. Money only via 06. Each ends at `rules/definition-of-done.md`. `(AC-n)/(FR-n)`.

## Schema & migration
- [x] T-1 `PosOrder`/`PosOrderItem`, `MenuItem`, `PosOutlet`, and the settlement columns are **confirmed present in canonical schema**; migration materializes the slice + `@@index([propertyId,status])` + `@@unique([propertyId,code])` and wires the per-property gap-free `code` counter (transactional). (FR-1/12)
- [x] T-2 Seed fixtures (OUT-REST, menu, RES-1 in-house, walk-in).

## Domain (write tests first)
- [x] T-3 `orderTotal` derived from lines. (FR-2, AC-1)
- [x] T-4 `billPreview` using shared `lib/tax` (CGST/SGST vs IGST, round-off). (FR-3/4, AC-2/3)
- [x] T-5 `canTransition` OPEN→SETTLED→VOID. (FR-10, AC-9)

## Application (integration tests)
- [x] T-6 `createOrder/addItem/removeItem` OPEN-only + preview + validation. (FR-1/2/3/16, AC-1/2/4)
- [x] T-7 `settleToFolio` → `billing.ensureFolio(reservationId)` → `billing.postFolioCharge` (POS writes no folio row) + event; row lock via `SELECT … FOR UPDATE` (no new enum state). (FR-5/8, AC-5)
- [x] T-8 Invalid folio target → `FOLIO_TARGET_INVALID` + offer direct. (FR-7, AC-6)
- [x] T-9 `settleDirect` → `billing.settlePosSaleDirect` (folio-less `ensureDirectSaleFolio`, `kind=DIRECT_SALE`) + store refs. (FR-6, AC-7)
- [x] T-10 `PosOrderSettled` payload drives 20 stock (decoupled, idempotent). (FR-9, AC-8)
- [x] T-11 `voidOrder` → `billing.reverseFolioLine` (folio path) / 06 credit note (direct path) + VOID + event + audit. (FR-11, AC-10)
- [x] T-12 Discount threshold + `folio:discount` override. (FR-15, AC-11)
- [x] T-13 `sendToKitchen` KOT without settle. (FR-13, AC-12)
- [x] T-14 `unsettledOrders` exposed to checkout gate. (FR-17, AC-13)
- [x] T-15 Concurrency: two settles → one wins `ORDER_NOT_OPEN`. (FR-18, AC-14)
- [x] T-16 RBAC: settle/void denied without perm. (FR-14, AC-15)

## UI (mobile-first)
- [x] T-17 Order screen (menu grid, steppers, live bill). (AC-1/2)
- [x] T-18 Settle sheet (folio vs direct); kitchen prep list. (AC-5/7/12)

## E2E
- [x] T-19 Journey: create order → KOT → settle to in-house folio → verify FolioLine(POS) in 06 + stock deducted in 20. (AC-1/5/8)

## Done
- [x] T-20 `/review-module` clean; every AC → green test; DoD satisfied.

## Guest QR ordering + kitchen lifecycle (addendum 2026-08-08) — test-first, money only via 06

### Phase 1 — kitchen ticket lifecycle + live KDS
- [ ] T-21 Migration: `PosOrderStatus`+=`REQUESTED`; `PosOrder`+=`source`,`guestNote?`; new `KitchenTicket`; coordinated `Room.orderToken @unique`. Reversible. (FR-19/21/24)
- [ ] T-22 Domain (test first): `KitchenTicket` state machine `QUEUED→PREPARING→READY→SERVED` — validated, no skip/backward. (FR-24, AC-19)
- [ ] T-23 `sendToKitchen` creates `KitchenTicket(QUEUED)`; `startTicket/readyTicket/serveTicket` (authorized, audited, `KitchenTicket*` events). Integration. (FR-24)
- [ ] T-24 Kitchen screen Start/Ready/Served + live via 17 SSE (add `KitchenTicket*` + `GuestOrderRequested` to the allow-list; subscribe boards). (FR-25, AC-21)

### Phase 2 — guest in-room QR ordering
- [ ] T-25 `Room.orderToken` generation + per-room QR image on the room detail page (qrcode lib — ADR written first). (FR-19, AC-16)
- [ ] T-26 Public route `(public)/order/[token]`: resolve token→room→configured outlet, occupied-gate, menu-only (no PII), rate-limited. Unit/integration for the gate + token failure. (FR-20/26, AC-17/22)
- [ ] T-27 `submitGuestOrder` (public, token-verified): create `PosOrder(REQUESTED, source=GUEST_QR)` server-priced + optional note + `GuestOrderRequested`; nothing charged/kitchened. Integration. (FR-21, AC-18)
- [ ] T-28 Staff "Room orders" inbox: `acceptGuestOrder` (REQUESTED→OPEN → sendToKitchen → **existing settleToFolio**) / `rejectGuestOrder` (→VOID). Integration incl. FolioLine(FOOD) money assertion + reject-charges-nothing + RBAC. (FR-22/23, AC-20)
- [ ] T-29 E2E: guest scans → orders → staff accepts → kitchen QUEUED→SERVED → FolioLine(FOOD) posted; occupied-gate + reject paths; two-device live update. (FR-19–25)

## Done (addendum)
- [ ] T-30 `/review-module` clean for the addendum; every new FR/AC → green test; DoD satisfied; `scope.md` note + qrcode ADR committed.
