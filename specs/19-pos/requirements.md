# 19 · POS (Restaurant / Point-of-Sale) — Requirements

> Source: client doc §19 ("Future Expansion" — full module in this build, `scope.md`). Read with `.claude/rules/business-rules.md` (§5–13 folio/GST), `rules/reporting.md`, `rules/non-functional-requirements.md`, `prisma/schema.prisma`. Depth bar: `specs/03-reservations/*`.

## Purpose & scope
Capture restaurant / room-service / bar sales as orders, price them with correct F&B GST, and **settle** them one of two ways: for an **in-house** guest, post the charge to that reservation's **folio** (owned by 06) as a `FolioLine(type=POS)`; otherwise settle **directly** with a payment and a GST sale document (issued by 06). POS owns the order-capture and kitchen workflow; **all money (folio lines, payments, invoices, tax split, numbering) stays in 06** — POS never writes `FolioLine`/`Payment`/`Invoice` rows itself. On settlement POS emits an event so inventory (20) deducts stock per recipe.

**In scope:** multiple outlets per property (Restaurant, Room-Service/Kitchen, Bar); order lifecycle (open → items/KOT → settle → void); menu catalog + per-line HSN/SAC + GST rate; live bill preview (subtotal, discount, CGST/SGST/IGST, round-off, total); settle-to-folio for in-house; settle-direct for walk-in; discount with threshold/override; void as reversal; sales queries; emitting the consumption event for 20.

**Out of scope:** folio ledger math, GST invoice generation, invoice numbering, payment capture/gateway, refunds — **all 06** (POS calls 06's public actions). Stock deduction, recipes-as-inventory, valuation — **20**. Table-management/waiter-rostering, KDS hardware, thermal-printer drivers, and offline order capture are **not** in this build (surfaced as open questions). Dynamic menu pricing — not in scope.

## Dependencies (`rules/architecture.md`, Tier 6)
- **Tier 0:** 00-platform (auth, tenancy, events, audit, pg-boss), 01-property-management (property/state/GSTIN), 02-room-inventory (outlet is *not* a room — see FR-13-note).
- **Tier 1:** 03-reservations (in-house reservation + status), 04-guest-crm (guest for named orders).
- **Tier 2:** 06-billing-payments (folio posting, direct-sale settlement, GST split, invoice numbering) — **hard dependency**, called via its public surface.
- **Peer (Tier 6):** 20-inventory-stock — decoupled via the `PosOrderSettled` event (no direct write; no cycle).
- **Downstream consumers:** 20-inventory (consume stock), 14-analytics (F&B revenue), 06 (money), 12-comms (receipt, via 06's `PaymentReceived`).

## Data owned
`PosOrder`, `PosOrderItem`. **Confirmed present in canonical schema:** `MenuItem` catalog, `PosOutlet` config, and settlement/tax columns on `PosOrder`/`PosOrderItem` (`reservationId?`, `settledAt`, `settledById`, `settlementInvoiceId?`, `settlementPaymentId?`, `subtotal/discount/cgst/sgst/igst/roundOff/totalPaise`) — migration materializes the slice, nothing new. Reads via other modules' query layers: `Reservation`/`Folio` (03/06), `Guest` (04), `RecipeComponent` (20, for the consumption payload). Calls `billing.postFolioCharge()` / `billing.settlePosSaleDirect()` (06).

## Functional requirements (EARS)
- **FR-1 (ubiquitous):** Represent every sale as a `PosOrder` scoped to one property and one `outlet`, with a unique human `code` (order/KOT number, gap-free per property). The gap-free `code` is drawn from a **per-property POS order-number sequence** (a transactional counter allocated inside the same tx that inserts the order — the same gap-free-numbering discipline 06 uses for invoices, `business-rules.md` §12), enforced by the `@@unique([propertyId, code])` constraint.
- **FR-2 (ubiquitous):** A `PosOrder` has ≥1 `PosOrderItem` capturing `name`, `quantity`, `unitPaise`, `amountPaise = quantity × unitPaise`; the order's `totalPaise` is **derived** from its lines and never trusted from the client (`business-rules.md` §21).
- **FR-3 (event):** When an item is added/updated/removed on an `OPEN` order, recompute the bill preview `{ subtotalPaise, discountPaise, cgstPaise, sgstPaise, igstPaise, roundOffPaise, totalPaise }` via the shared bill function; no money is posted while `OPEN`.
- **FR-4 (ubiquitous):** Compute F&B GST **per line** by HSN/SAC and applicable rate using the single shared split (`lib/tax`, the same one 06 uses). POS F&B is a **point-of-consumption service supplied on-premise**, so its place of supply is **always the property's own state** (`business-rules.md` §10; IGST Act §12(4)) — the split is therefore **always CGST+SGST, regardless of the guest's/corporate bill-to state**, and IGST never applies to a POS line. POS resolves place of supply via the same `placeOfSupply(type=POS, propertyState, …)` helper 06 uses (which returns the property state for on-premise types), never off the customer address. Rate is **config-driven** per outlet/menu-item, never hard-coded (`business-rules.md` §11).
- **FR-5 (event):** When an `OPEN` order for an **in-house** guest (linked `reservationId`, reservation `IN_HOUSE`, folio open) is settled, POS calls `billing.postFolioCharge()` which appends a `FolioLine(type=POS)` with the taxable value + CGST/SGST/IGST + HSN/SAC; POS writes **no** folio row itself.
- **FR-6 (event):** When an order is settled for a guest who is **not** in-house (walk-in/takeaway), POS calls `billing.settlePosSaleDirect()` which takes the **folio-less/direct-sale path** — 06 obtains a house folio via `ensureDirectSaleFolio(propertyId)` (`Folio.reservationId` null, `kind=DIRECT_SALE` — both in canonical schema), records the `Payment`, and issues a gap-free GST sale document from 06's series; POS stores the returned `invoiceId`/`paymentId`/settlement ref on the order.
- **FR-7 (unwanted):** If a settle-to-folio target is invalid (reservation not `IN_HOUSE`, folio closed/missing), then reject with `FOLIO_TARGET_INVALID` and offer direct settlement; nothing posts.
- **FR-8 (event):** When an order is settled, set status `SETTLED`, stamp `settledAt`/`settledById`, emit `PosOrderSettled`, and write audit; the money event (`FolioCharged` or `PaymentReceived`+`InvoiceIssued`) is emitted by 06 in the same settlement transaction.
- **FR-9 (event):** When an order is settled, emit `PosOrderSettled` carrying `{ propertyId, outlet, items:[{menuItemId, quantity}] }` so inventory (20) deducts stock per recipe; POS writes **no** inventory row (decoupled, idempotent on order id).
- **FR-10 (unwanted):** If an illegal status transition is requested (`SETTLED`→add item, `VOID`→settle, re-settle a `SETTLED` order), reject it; a `SETTLED` order is **immutable**.
- **FR-11 (unwanted):** If a settled order must be corrected, then void it (permission `pos:order-void`): for the folio path POS calls `billing.reverseFolioLine(lineId, reason)` which appends a reversing `FolioLine(type=REVERSAL)`; for the direct path 06 issues a credit note — **append-only**, never edit/delete — set status `VOID`, emit `PosOrderVoided`, audit.
- **FR-12 (ubiquitous):** Support multiple outlets per property; each order names its `outlet`; outlet config supplies the default menu, HSN/SAC and GST band (§11).
- **FR-13 (state):** While `OPEN`, an order may be sent to the kitchen (KOT) without settling; the kitchen view shows an aggregated prep list. *(POS `outlet` is a sales point, never a `Room` — inventory of stock is 20, not 02.)*
- **FR-14 (ubiquitous):** Every POS mutation is property-scoped, authorized server-side (`pos:*` permissions), audited, and emits its domain event (`business-rules.md` §20).
- **FR-15 (unwanted):** If a discount above the role threshold is applied, require permission `folio:discount` and write an audited override; otherwise reject (mirrors 03 FR-19, keeps discount authority in one place).
- **FR-16 (unwanted):** If any line has `quantity ≤ 0` or `unitPaise < 0`, reject at validation (`VALIDATION_FAILED`); nothing persists.
- **FR-17 (state):** While a reservation is `IN_HOUSE`, its **unsettled** POS orders are exposed to check-out (03/06) via a query; check-out is blocked/settled-first per 06's balance gate — POS never lets an open order silently disappear at check-out.
- **FR-18 (unwanted):** If two operators settle the same `OPEN` order concurrently, exactly one succeeds; the other gets `ORDER_NOT_OPEN` (row-locked status transition) — a charge is never double-posted.

## Non-functional (cited)
Bill-preview recompute feels instant (optimistic, server confirm p95 < 800ms); settlement p95 < 800ms; sales list p95 < 500ms on the seeded dataset; usable one-thumb on a phone at the table (`rules/non-functional-requirements.md`). No double-posting under concurrency (correctness on the money path).

## Business rules referenced
`business-rules.md` §5 (one folio per in-house reservation; POS posts to it), §6–8 (append-only, derived balance, paise + Decimal, round half-up per line), §10–11 (GST split; config-driven F&B rate), §12–13 (gap-free invoice numbering — 06 owns it), §18–19 (status transitions), §20–21 (validate→authorize→transaction→event→audit; no divergent client recompute).
