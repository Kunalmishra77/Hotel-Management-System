# 20 · Inventory (Stock) — User Stories & Acceptance Criteria

Roles per `rules/user-roles.md`.

## Test Fixtures
| Ref | Value |
|---|---|
| PROP-A | Property |
| I-RICE | InventoryItem "Rice", unit kg, reorderLevel 20, on-hand 25 |
| I-COFFEE | InventoryItem "Coffee beans", reorderLevel 5, on-hand 5.5 (off the boundary) |
| RECIPE | Coffee (menu) consumes 0.02 kg coffee beans/cup |
| U-STORE | User with `inventory:manage` |

## US-1 — Item & movements
- **AC-1:** Given U-STORE, when creating I-RICE (unit kg, reorder 20), then it persists; on-hand starts from movements. (FR-1)
- **AC-2:** Given a 50 kg purchase of rice (ref a 07 expense), when recorded, then a positive movement posts and on-hand = 75. (FR-2)
- **AC-3:** Given a duplicate item name in PROP-A, when created, then rejected. (FR-1)

## US-2 — POS consumption (decoupled)
- **AC-4:** Given a `PosOrderSettled` with 50 cups of coffee and RECIPE 0.02 kg/cup, when consumed, then coffee beans on-hand drops by 1.0 kg (5.5 → 4.5); re-delivery of the same order id deducts nothing extra — enforced by `InventoryMovement @@unique([refType, refId, itemId])` (idempotent). (FR-3)

## US-3 — Reorder alerts
- **AC-5:** Given I-COFFEE on-hand 5.5 drops **strictly below** reorderLevel 5 after the 1.0 kg consumption (→ 4.5 < 5), then `LowStockDetected` is emitted (12 reminds); had it landed exactly on 5 it would **not** fire (`belowReorder` is strict `<`). (FR-4)

## US-4 — Guardrails / permission
- **AC-6:** Given negative-stock disallowed, when a consumption would make on-hand negative, then flagged `NEGATIVE_STOCK` (not silent). (FR-5)
- **AC-7:** Given a user without `inventory:manage`, when mutating, then `FORBIDDEN`. (FR-6)
