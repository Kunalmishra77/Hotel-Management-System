# 20 · Inventory (Stock) — Tasks

Test-first for on-hand/consumption. Decoupled from POS via events. Each ends at `rules/definition-of-done.md`. `(AC-n)/(FR-n)`.

## Schema & migration
- [x] T-1 `InventoryItem` (cached `onHand`), `InventoryMovement` (`@@unique([refType,refId,itemId])`), and `RecipeComponent` are **confirmed present in canonical schema**; migration materializes the slice + unique `(propertyId,name)`.
- [x] T-2 Seed fixtures (I-RICE, I-COFFEE, RECIPE).

## Domain (tests first)
- [x] T-3 `onHand` from movements. (FR-1, AC-2)
- [x] T-4 `consumptionFor` POS→deductions. (FR-3, AC-4)
- [x] T-5 `belowReorder` strict `<` (boundary: on-hand == reorderLevel does not fire). (FR-4, AC-5)

## Application (integration tests)
- [x] T-6 `createItem` unique name. (FR-1, AC-1/3)
- [x] T-7 `recordMovement` purchase/consume + negative-stock guard. (FR-2/5, AC-2/6)
- [x] T-8 `PosOrderSettled` consumer deducts per recipe, idempotent via `InventoryMovement @@unique([refType,refId,itemId])` (redelivery = no-op). (FR-3, AC-4)
- [x] T-9 Low-stock crossing → `LowStockDetected`. (FR-4, AC-5)
- [x] T-10 RBAC: `inventory:manage` required. (FR-6, AC-7)

## UI (mobile-first)
- [x] T-11 Stock list + stock-in + movement history + low badges. (AC-1/2/5)

## E2E
- [x] T-12 Journey: stock in → POS order settles → stock deducts → low-stock alert fires. (AC-2/4/5)

## 6 domains + laundry reconciliation (addendum 2026-08-09)
- [x] T-14 Schema + migration: `InventoryDomain` enum + `InventoryItem.domain` (default GENERAL, backfill); `LaundryBatch` + `LaundryBatchItem` models + indexes. (FR-7/8)
- [x] T-15 Domain `laundryLineStatus(sent,returned,tolerance)` → `{balance, status: OK|SHORT|PENDING}` — unit tests incl. 250/149=101 SHORT + tolerance edges. (FR-8)
- [x] T-16 `createStockItem`/`updateStockItem` schemas gain `domain`; listing gains a domain filter. (FR-7)
- [x] T-17 `createLaundryBatch` (inventory:manage) → OPEN batch + lines + `LaundryBatchCreated` + audit. (FR-8/10)
- [x] T-18 `recordLaundryReturns` → set returnedQty per line; all recorded → RECONCILED + `reconciledAt` + `LaundryBatchReconciled` + audit. (FR-9/10)
- [x] T-19 Queries `listLaundryBatches` (per-line balance/status + batch totals); `/inventory` domain filter + Laundry sub-view UI (create batch + record returns + OK/SHORT badges), mobile-first.
- [x] T-20 Integration: create→record→balance/SHORT/RECONCILED, RBAC (LAUNDRY_SUPERVISOR can, non-inventory role denied), item domain persists. Events in catalog.

## Done
- [x] T-13 `/review-module` clean; every AC → green test; DoD satisfied.
