/**
 * The events 20-inventory emits and consumes — mirrors the catalogue
 * (src/lib/events/catalog.ts, docs/architecture/domain-events.md).
 *
 * Emits:
 *  - `StockMovementRecorded` — every purchase/consumption/adjust (aggregateId = itemId).
 *  - `LowStockDetected`      — only when on-hand crosses strictly below reorder (FR-4).
 * Consumes:
 *  - `PosOrderSettled` (19)  — by type STRING only; 20 never imports 19.
 *
 * `POS_ORDER_REF_TYPE` is the `InventoryMovement.refType` used for POS-driven
 * consumption; together with the order id (`refId`) and `itemId` it forms the
 * idempotency key `@@unique([refType, refId, itemId])` (FR-3).
 */
export const INVENTORY_EMITTED_EVENTS = ["StockMovementRecorded", "LowStockDetected"] as const;
export const INVENTORY_CONSUMED_EVENTS = ["PosOrderSettled"] as const;

/** refType stamped on movements sourced from a settled POS order. */
export const POS_ORDER_REF_TYPE = "PosOrder";
/** refType stamped on movements sourced from a 07 expense (AC-11). */
export const EXPENSE_REF_TYPE = "Expense";
