# 20 · Inventory (Stock) — Requirements

> Source: client doc §19. Distinct from ROOM inventory (02). Read with `prisma/schema.prisma` (`InventoryItem`, `InventoryMovement`). Depth bar: `specs/03-reservations/*`.

## Purpose & scope
Track store/stock items (provisions, linen, toiletries, consumables) per property: quantity on hand, purchases in, consumption out (from POS recipes / expenses), reorder levels, and low-stock alerts.

**In scope:** item catalog; stock movements (in/out) with reason + reference; on-hand quantity derivation; reorder levels + low-stock alert events; consumption from `PosOrderSettled` (19) via recipes; purchase from expenses (07).
**Out of scope:** POS orders (19), expense entry (07), room inventory (02), procurement/PO workflow (not in this build — open question), valuation/accounting (22 optional).

## Dependencies
- **Tier 0:** 00, 01.
- **Peer (Tier 6):** 19-pos (consumes `PosOrderSettled`), 07-expenses (purchase reference).
- **Consumed by:** 12 (low-stock reminder), 14 (context).

## Data owned
`InventoryItem` (incl. cached `onHand`), `InventoryMovement` (with `@@unique([refType, refId, itemId])`), `RecipeComponent(menuItemId, itemId, qtyPerUnit)` — all **confirmed present in canonical schema** (migration materializes the slice; nothing new). `PurchaseReceipt` remains an open question (not in this build).

## Functional requirements (EARS)
- **FR-1 (ubiquitous):** Maintain an `InventoryItem` per property (name unique per property, unit, category, `reorderLevel`, `lastCostPaise`); on-hand `quantity` is derived from movements.
- **FR-2 (event):** When stock is purchased/received, record a positive `InventoryMovement` (reason PURCHASE, optional ref to a 07 expense); when consumed, a negative movement.
- **FR-3 (event):** When `PosOrderSettled` (19) is received, deduct stock per `RecipeComponent` for each menu item×quantity, idempotently — the deduction writes one `InventoryMovement(refType="PosOrder", refId=orderId, itemId)` per item and the DB `@@unique([refType, refId, itemId])` constraint makes a redelivered event a no-op (deducts exactly once).
- **FR-4 (event):** When an item's derived on-hand crosses **strictly below** `reorderLevel` (`onHand < reorderLevel`; landing exactly on the level does **not** trigger), emit `LowStockDetected` (consumed by 12 for a reminder).
- **FR-5 (unwanted):** If a movement would make on-hand negative and negative stock is disallowed (config), flag it (`NEGATIVE_STOCK`) rather than silently proceeding.
- **FR-6 (ubiquitous):** Every inventory mutation is property-scoped, authorized server-side against `inventory:manage`, audited, and (where relevant) emits its domain event.

## 6 domains + laundry reconciliation (addendum 2026-08-09, MoM line 28)
- **FR-7 (domains):** Every `InventoryItem` carries a `domain ∈ {General, Housekeeping, Laundry, Kitchen, Maintenance, Store}` (the MoM's six separate inventory domains); free-text `category` remains an optional sub-label. Existing items default to `General`. Item create/update accept the domain; the listing can filter by it.
- **FR-8 (laundry batch):** Laundry linen is reconciled **sent vs returned**. A `LaundryBatch` (property-scoped, `sentOn` date, optional vendor, status `OPEN → RECONCILED`) has line items, each with `itemName`, `sentQty`, `returnedQty`, and a per-line `toleranceQty`. Balance = `sentQty − returnedQty`; a line is **SHORT** when `balance > toleranceQty`, **PENDING** before returns are recorded, else **OK** (within tolerance). Example (MoM): 250 out / 149 back = 101 balance → SHORT unless tolerance ≥ 101.
- **FR-9 (record returns):** `recordLaundryReturns` sets each line's `returnedQty`; when every line has returns recorded the batch becomes `RECONCILED` (stamps `reconciledAt`). Quantities are integer counts (linen pieces), never money.
- **FR-10 (RBAC + events):** Laundry batches are gated on `inventory:manage` (held by LAUNDRY_SUPERVISOR + managers/inventory roles), property-scoped, audited; create emits `LaundryBatchCreated`, full reconciliation emits `LaundryBatchReconciled` (not broadcastable — no SSE).

## Non-functional (cited)
On-hand + movement history within list budgets via indexes; usable on a phone for quick stock-in; consumption event processing idempotent. (`non-functional-requirements.md`)

## Business rules referenced
`business-rules.md` §20 (validate→authorize→transaction→event→audit); event-driven decoupling from POS (`architecture.md`).
