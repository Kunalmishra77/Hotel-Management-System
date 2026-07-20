# 19 · POS — Tasks

Test-first for bill/tax + state machine. Money only via 06. Each ends at `rules/definition-of-done.md`. `(AC-n)/(FR-n)`.

## Schema & migration
- [ ] T-1 `PosOrder`/`PosOrderItem`, `MenuItem`, `PosOutlet`, and the settlement columns are **confirmed present in canonical schema**; migration materializes the slice + `@@index([propertyId,status])` + `@@unique([propertyId,code])` and wires the per-property gap-free `code` counter (transactional). (FR-1/12)
- [ ] T-2 Seed fixtures (OUT-REST, menu, RES-1 in-house, walk-in).

## Domain (write tests first)
- [ ] T-3 `orderTotal` derived from lines. (FR-2, AC-1)
- [ ] T-4 `billPreview` using shared `lib/tax` (CGST/SGST vs IGST, round-off). (FR-3/4, AC-2/3)
- [ ] T-5 `canTransition` OPEN→SETTLED→VOID. (FR-10, AC-9)

## Application (integration tests)
- [ ] T-6 `createOrder/addItem/removeItem` OPEN-only + preview + validation. (FR-1/2/3/16, AC-1/2/4)
- [ ] T-7 `settleToFolio` → `billing.ensureFolio(reservationId)` → `billing.postFolioCharge` (POS writes no folio row) + event; row lock via `SELECT … FOR UPDATE` (no new enum state). (FR-5/8, AC-5)
- [ ] T-8 Invalid folio target → `FOLIO_TARGET_INVALID` + offer direct. (FR-7, AC-6)
- [ ] T-9 `settleDirect` → `billing.settlePosSaleDirect` (folio-less `ensureDirectSaleFolio`, `kind=DIRECT_SALE`) + store refs. (FR-6, AC-7)
- [ ] T-10 `PosOrderSettled` payload drives 20 stock (decoupled, idempotent). (FR-9, AC-8)
- [ ] T-11 `voidOrder` → `billing.reverseFolioLine` (folio path) / 06 credit note (direct path) + VOID + event + audit. (FR-11, AC-10)
- [ ] T-12 Discount threshold + `folio:discount` override. (FR-15, AC-11)
- [ ] T-13 `sendToKitchen` KOT without settle. (FR-13, AC-12)
- [ ] T-14 `unsettledOrders` exposed to checkout gate. (FR-17, AC-13)
- [ ] T-15 Concurrency: two settles → one wins `ORDER_NOT_OPEN`. (FR-18, AC-14)
- [ ] T-16 RBAC: settle/void denied without perm. (FR-14, AC-15)

## UI (mobile-first)
- [ ] T-17 Order screen (menu grid, steppers, live bill). (AC-1/2)
- [ ] T-18 Settle sheet (folio vs direct); kitchen prep list. (AC-5/7/12)

## E2E
- [ ] T-19 Journey: create order → KOT → settle to in-house folio → verify FolioLine(POS) in 06 + stock deducted in 20. (AC-1/5/8)

## Done
- [ ] T-20 `/review-module` clean; every AC → green test; DoD satisfied.
