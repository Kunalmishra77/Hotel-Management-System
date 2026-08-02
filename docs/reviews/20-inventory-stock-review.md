# /review-module — 20-inventory-stock

**Date:** 2026-08-03 · **Reviewer:** implementing engineer (self-review, per DoD § Review)
**Built by:** delegated subagent (parallel Tier-6 batch); **integrated + verified serially by the parent.**
**Depends on:** 00 (events/consumer). **Consumes:** 19's `PosOrderSettled` (by event type, decoupled).
**Tier 6.** Owns `InventoryItem`, `InventoryMovement`, `RecipeComponent`.

## 1. Traceability — AC → test
**15 unit** + **12 integration** + **1 e2e**.

| AC | Requirement | Covered by |
|---|---|---|
| AC-1/3 | `createItem` unique name | integration (persist + duplicate → CONFLICT) |
| AC-2 | on-hand from movements (25+50=75) | `on-hand` unit · integration |
| AC-4 | `PosOrderSettled` consumer deducts per recipe | `consumption` unit · integration |
| AC-5 | Low-stock crossing (strict `<`) → `LowStockDetected` | `reorder` unit (boundary) · integration |
| AC-6 | Negative-stock guard → `NEGATIVE_STOCK` | integration |
| AC-7 | RBAC `inventory:manage` | integration |
| AC-8 | Consumer idempotent on re-delivery | integration (movement count == 1) |
| AC-9 | `adjustStock` reconcile + audit | integration |
| AC-10 | Missing recipe → skip | `consumption` unit · integration |
| AC-11 | Expense-ref purchase | integration |

## 2. Invariants
| Invariant | Status |
|---|---|
| Decoupled from POS via events | ✅ consumes `PosOrderSettled` by type; no import of 19 |
| Idempotent consumer | ✅ `InventoryMovement @@unique([refType,refId,itemId])` — re-delivery no-ops |
| on-hand truth = Σ movements | ✅ cache updated atomically with each movement |
| Negative-stock guarded | ✅ manual movement rejects below zero; POS consumer posts (sale already happened) then flags low-stock |
| Reorder strict `<` | ✅ on-hand == reorderLevel does not fire |

## Decisions
- **D-1:** POS consumer passes `allowNegative:true` — a settled sale already happened, so the deduction posts even below zero (then crosses reorder → LowStock) rather than dead-lettering. Manual movements enforce the guard (`INVENTORY_ALLOW_NEGATIVE_STOCK`, default off).
- **D-2:** `refType="PosOrder"`, `refId=orderId` (from the event `aggregateId`) — the idempotency key aligns with 19's emitted payload.
- **D-3:** scoped `inventoryItem.update` → `updateMany` (scoped-client unique-where fix) — corrected at merge.

## Carried risks
- **R-37** `PosOrderSettled` payload contract: reads `items:[{menuItemId, quantity}]` + `aggregateId` fallback — verified compatible with 19's emit. `RecipeComponent.menuItemId` has no FK to `MenuItem`, keeping 20 fully decoupled.
