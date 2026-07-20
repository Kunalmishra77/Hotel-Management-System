# 20 · Inventory (Stock) — Design

## Schema slice (from canonical `prisma/schema.prisma`)
Owns `InventoryItem` (unique `(propertyId, name)`, with cached `onHand` reconciled from movements for fast lists — **confirmed present**), `InventoryMovement` (**`@@unique([refType, refId, itemId])`** — confirmed present), `RecipeComponent(menuItemId, itemId, qtyPerUnit)` — **confirmed present in canonical schema** (migration materializes the slice). `PurchaseReceipt` remains an open question (not in this build).

## Domain layer (pure) — `features/inventory/domain/`
- `onHand(movements): number` — sum of deltas (FR-1).
- `consumptionFor(order, recipes): Movement[]` — POS order → stock deductions (FR-3).
- `belowReorder(onHand, reorderLevel): boolean` — strict `onHand < reorderLevel` (on-hand exactly equal to the level is **not** below) (FR-4).

## Application — actions & consumers (`features/inventory`)
- `createItem/updateItem` — `inventory:manage`. (FR-1)
- `recordMovement(itemId, delta, reason, ref)` — `inventory:manage`; purchase/consume/adjust; negative-stock guard. (FR-2/5)
- Consumer on `PosOrderSettled` (19): deduct per recipe, made idempotent by the `InventoryMovement @@unique([refType, refId, itemId])` constraint (a redelivered event upserts the same movement rows once, no double-deduct); on cross strictly below reorder → `LowStockDetected`. (FR-3/4)
- Query `stockLevels(propertyId)`.

## UI — wireframes (mobile-first)
```
┌───────────────────────────┐
│ Stock · MG Road           │
│ Rice        75 kg   ✓     │
│ Coffee beans 5 kg   ⚠ low │
│ [+ Stock in]              │
│ Movements ▸               │
└───────────────────────────┘
```
Quick stock-in; low-stock badges; movement history.

## Events
Emits: `StockMovementRecorded`, `LowStockDetected`. Consumes: `PosOrderSettled` (19). Catalog: `docs/architecture/domain-events.md`.

## Error catalog
`ITEM_NAME_IN_USE`, `NEGATIVE_STOCK`, `FORBIDDEN`, `VALIDATION_FAILED`.

## Edge cases
- Re-delivered `PosOrderSettled` → idempotent via `InventoryMovement @@unique([refType, refId, itemId])` (no double deduct).
- Missing recipe for a menu item → skip with a flagged note (no crash).
- Manual adjustment (stock-take) → an ADJUST movement, audited.
- Negative stock allowed vs flagged is config-explicit.
