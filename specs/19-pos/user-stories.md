# 19 · POS — User Stories & Acceptance Criteria

Roles per `rules/user-roles.md`. All money stays in 06; POS never writes folio/payment/invoice rows.

## Test Fixtures
| Ref | Entity | Value |
|---|---|---|
| PROP-A | Property | Karnataka |
| OUT-REST | PosOutlet | "Restaurant", default GST band 5% (F&B) |
| MENU-1 | MenuItem | "Masala Dosa" ₹120, HSN `996331`, 5% |
| MENU-2 | MenuItem | "Coffee" ₹60, 5% |
| RES-1 | Reservation | G-RAVI, IN_HOUSE, folio open |
| WALKIN | (no reservation) | walk-in guest |
| U-POS | User | has `pos:order-create`, `pos:order-settle` |
| U-MGR | User | + `pos:order-void`, `folio:discount` |

## US-1 — Capture an order
- **AC-1:** Given U-POS at OUT-REST, when creating an order with 2× Masala Dosa + 1× Coffee, then a `PosOrder(OPEN)` with a gap-free `code` and items persists; `totalPaise` is **derived** (2×12000 + 6000 = 30000), never trusted from client. (FR-1/2)
- **AC-2:** Given the OPEN order, when an item is added/removed, then the bill preview `{subtotal, discount, cgst, sgst, igst, roundOff, total}` recomputes via the shared bill function; **no money posts while OPEN**. (FR-3)
- **AC-3:** Given intra-state PROP-A at 5%, when previewed, then CGST 2.5% + SGST 2.5% each rounded half-up independently; an inter-state place-of-supply yields IGST 5%. (FR-4)
- **AC-4:** Given a line with quantity 0 or negative price, when submitted, then `VALIDATION_FAILED`; nothing persists. (FR-16)

## US-2 — Settle to folio (in-house)
- **AC-5:** Given RES-1 IN_HOUSE, when the order is settled to folio, then POS calls `billing.ensureFolio(reservationId)` (idempotent → open `folioId`) then `billing.postFolioCharge()` which appends a `FolioLine(type=POS)` with taxable value + GST + HSN; POS writes no folio row; the order row is locked via `SELECT … FOR UPDATE` while `OPEN` (no new enum state); order → SETTLED; `PosOrderSettled` emitted. (FR-5/8)
- **AC-6:** Given a settle-to-folio target that is not IN_HOUSE / folio closed, when attempted, then `FOLIO_TARGET_INVALID` and direct settlement is offered; nothing posts. (FR-7)

## US-3 — Settle direct (walk-in)
- **AC-7:** Given WALKIN, when the order is settled directly, then POS calls `billing.settlePosSaleDirect()` which takes the folio-less path — 06 uses `ensureDirectSaleFolio(propertyId)` → `Folio(reservationId=null, kind=DIRECT_SALE)` — records the `Payment` and issues a GST sale doc from 06's series; the returned `invoiceId`/`paymentId` are stored on the order. (FR-6)

## US-4 — Stock consumption (decoupled)
- **AC-8:** Given a settled order, when `PosOrderSettled` is emitted with `{items:[{menuItemId, quantity}]}`, then inventory (20) deducts stock per recipe; POS writes no inventory row (idempotent on order id). (FR-9)

## US-5 — Void & immutability
- **AC-9:** Given a SETTLED order, when adding an item / re-settling, then rejected — SETTLED is immutable. (FR-10)
- **AC-10:** Given U-MGR voids a settled order, then POS calls `billing.reverseFolioLine(lineId, reason)` which appends a reversing `FolioLine(REVERSAL)` (folio path) or a 06 credit note (direct path) — append-only; order → VOID; `PosOrderVoided` emitted + audited. (FR-11)

## US-6 — Discounts, kitchen, checkout
- **AC-11:** Given a discount above U-POS's threshold without `folio:discount`, when applied, then rejected; U-MGR with the permission succeeds + audited override. (FR-15)
- **AC-12:** Given an OPEN order, when sent to kitchen (KOT), then the kitchen view shows an aggregated prep list without settling. (FR-13)
- **AC-13:** Given RES-1 has unsettled POS orders, when checkout is attempted (03/06), then those orders are exposed and checkout is blocked/settled-first per 06's balance gate — none silently vanish. (FR-17)

## Concurrency / permission
- **AC-14:** Given two operators settle the same OPEN order concurrently, then exactly one succeeds; the other gets `ORDER_NOT_OPEN` — no double post. (FR-18)
- **AC-15:** Given a user without `pos:order-settle`, when settling, then `FORBIDDEN`. (FR-14)
