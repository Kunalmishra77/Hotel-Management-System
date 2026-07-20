# 20 · Inventory (Stock) — Tasks

Test-first for on-hand/consumption. Decoupled from POS via events. Each ends at `rules/definition-of-done.md`. `(AC-n)/(FR-n)`.

## Schema & migration
- [ ] T-1 `InventoryItem` (cached `onHand`), `InventoryMovement` (`@@unique([refType,refId,itemId])`), and `RecipeComponent` are **confirmed present in canonical schema**; migration materializes the slice + unique `(propertyId,name)`.
- [ ] T-2 Seed fixtures (I-RICE, I-COFFEE, RECIPE).

## Domain (tests first)
- [ ] T-3 `onHand` from movements. (FR-1, AC-2)
- [ ] T-4 `consumptionFor` POS→deductions. (FR-3, AC-4)
- [ ] T-5 `belowReorder` strict `<` (boundary: on-hand == reorderLevel does not fire). (FR-4, AC-5)

## Application (integration tests)
- [ ] T-6 `createItem` unique name. (FR-1, AC-1/3)
- [ ] T-7 `recordMovement` purchase/consume + negative-stock guard. (FR-2/5, AC-2/6)
- [ ] T-8 `PosOrderSettled` consumer deducts per recipe, idempotent via `InventoryMovement @@unique([refType,refId,itemId])` (redelivery = no-op). (FR-3, AC-4)
- [ ] T-9 Low-stock crossing → `LowStockDetected`. (FR-4, AC-5)
- [ ] T-10 RBAC: `inventory:manage` required. (FR-6, AC-7)

## UI (mobile-first)
- [ ] T-11 Stock list + stock-in + movement history + low badges. (AC-1/2/5)

## E2E
- [ ] T-12 Journey: stock in → POS order settles → stock deducts → low-stock alert fires. (AC-2/4/5)

## Done
- [ ] T-13 `/review-module` clean; every AC → green test; DoD satisfied.
