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
- **AC-3:** Given PROP-A at 5%, when previewed, then CGST 2.5% + SGST 2.5% each rounded half-up independently — and **always** so: POS F&B is consumed on-premise, so place-of-supply = the property's state (§10), which pins the split to CGST+SGST **regardless of the guest's/corporate bill-to state**; `igst` is `0` for every POS line. (The shared `lib/tax` engine keeps an IGST branch only for 06's rare genuine off-premise supply; POS never takes it.) (FR-4)
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

## Addendum 2026-08-08 — guest QR ordering + kitchen lifecycle
Added fixtures: **ROOM-101** (a `Room` at PROP-A with a stamped `orderToken`), **G-QR** (an anonymous guest device — no login).

### US-7 — Guest self-orders from the in-room QR
- **AC-16:** Given ROOM-101, when its detail page is opened by staff, then a scannable per-room QR encoding `…/order/<orderToken>` is shown/printable; the token is distinct per room. (FR-19)
- **AC-17:** Given ROOM-101 has **no** IN_HOUSE reservation, when the QR page is opened, then a generic "ordering unavailable" is shown and no order can be placed; the page returns menu data only, never PII. (FR-20/26)
- **AC-18:** Given ROOM-101 is IN_HOUSE, when G-QR submits 2× Masala Dosa (+ note), then a `PosOrder(status=REQUESTED, source=GUEST_QR)` linked to the room's in-house reservation persists, **server-priced** (client prices ignored), `GuestOrderRequested` emitted; **nothing is charged and no kitchen ticket exists yet**. (FR-21)

### US-8 — Staff accept / reject (money gate)
- **AC-19:** Given a `KitchenTicket`, when advanced, then only `QUEUED→PREPARING→READY→SERVED` (forward, no skip) is allowed; an illegal move → `ILLEGAL_TICKET_TRANSITION`. (FR-24)
- **AC-20:** Given a REQUESTED guest order, when U-POS **accepts** it, then order → OPEN, a `KitchenTicket(QUEUED)` is created, and the charge posts via the existing `settleToFolio` (`FolioLine(type=FOOD)`, CGST+SGST, place-of-supply = property state); when U-MGR **rejects** it, then order → VOID and **nothing is charged**. A guest can never accept/settle their own order. (FR-22/23)

### US-9 — Live boards
- **AC-21:** Given the Room-orders inbox and the kitchen screen open on a second device, when a guest submits / a ticket is advanced, then both update **live** via SSE within the realtime budget, no manual refresh; payloads carry no PII (type + ids only). (FR-25)
- **AC-22:** Given an unknown/tampered `orderToken` or a flood of requests, when hitting the public endpoint, then a generic unavailable response + rate-limiting; no room/guest enumeration, no authenticated surface reachable. (FR-26)
