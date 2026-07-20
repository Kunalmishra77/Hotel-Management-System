# 06 · Billing & Payments — Design

## Schema slice (from canonical `prisma/schema.prisma`)
Owns `Folio`, `FolioLine` (append-only), `Payment` (append-only, incl. refunds), `InvoiceSeries`, `Invoice`. Reads `Reservation`, `Property`, `RoomCategory`, `Guest`/`Corporate`. GST config in `lib/constants/gst.ts` (tariff band→bps, HSN/SAC→rate). Indexes `FolioLine(folioId)`, `(businessDate)`, `Payment(folioId)`, `(propertyId, receivedAt)`, `Invoice(propertyId, number)` unique.

**Schema notes — confirmed present in canonical schema** (migration T-1 materializes this slice, but nothing here is "new"):
- `Invoice.type` (`InvoiceType` = TAX_INVOICE | CREDIT_NOTE, default TAX_INVOICE) + `Invoice.cancelsInvoiceId` for voids/credit notes (FR-21) — present.
- `Invoice.pdfObjectKey` is **nullable** — the invoice is inserted with it null and the PDF is attached after commit (FR-12).
- `FolioLine.placeOfSupplyState` for intra/inter-state determination (FR-4) — present.
- `Payment.settlementBatchId` groups split tenders under one `PaymentReceived` event (FR-8) — present.
- `Payment.amountPaise` stored **positive** with `isRefund` carrying direction (FR-10) — present.
- `Folio.kind` (RESERVATION | DIRECT_SALE) + **nullable** `Folio.reservationId` for walk-in/house folios (FR-25) — present.
- **BigInt paise** on `FolioLine.amountPaise` / `Payment.amountPaise` / `Invoice.taxableValuePaise`/`totalPaise` and `Corporate.creditLimitPaise`/`receivablePaise` (accumulating totals) — present; tax components (`cgstPaise`/`sgstPaise`/`igstPaise`) and per-unit `unitPaise` are `Int`.

## Domain layer (pure, the most-tested code in the app) — `features/billing/domain/`
- `placeOfSupply(chargeType, propertyState, billToState): string` — for accommodation + on-premise services (`ROOM/FOOD/LAUNDRY/AIRPORT_TRANSFER/TAXI/KITCHEN/EXTRA_BED/POS`) returns **the property's state** (always intra-state → CGST+SGST, regardless of bill-to); only a rare genuine off-premise supply resolves to a different state (→ IGST). (FR-4)
- `computeGst(amountPaise, rateBps, propertyState, placeOfSupply): { cgst, sgst, igst }` — `placeOfSupply == propertyState` → CGST=SGST (each half-up, independent); else → IGST. The place of supply is decided by `placeOfSupply(...)` above, **not** by the guest's bill-to state. (FR-4/19)
- `folioBalance(lines, payments): bigint` — the single derivation: `Σ(line.amount + cgst + sgst + igst) − Σ(non-refund payment) + Σ(refund payment)`. Because `Payment.amountPaise` is stored positive and `isRefund` carries direction, refunds are **added back**. (FR-3/10)
- `roundPaiseHalfUp(decimal): number`.
- `splitSumsTo(parts, total): boolean` (FR-23).
- `refundWithinNetPaid(refundPaise, payments): boolean` — `netPaid = Σ(non-refund payment.amountPaise) − Σ(refund payment.amountPaise)`; true iff `refundPaise ≤ netPaid`. (FR-10/23)
- `discountLine(baseTaxablePaise, rateBps, propertyState, placeOfSupply, mode): FolioLine` — **pre-tax** mode returns a negative `DISCOUNT` line with negated proportional CGST/SGST (or IGST); **financial-only** mode returns a negative line with zero tax. (FR-6)
- `financialYearOf(date, timezone): string` — Indian FY string `"YYYY-YY"` with the **1 April boundary** (Jan–Mar of year N belong to FY `(N-1)-(N)`); computed in property-local time. (FR-12)
- `amountInWords(paise): string` (Indian numbering, for invoices — FR-16).
- `nextInvoiceNumber(series): { number, financialYear }` (pure formatting; allocation is transactional).

## Application — server actions (`features/billing/actions.ts`)
Per `api-conventions.md`: zod → authorize → transaction → event + audit. All money via domain fns. **Canonical action names per `docs/architecture/contracts.md`.**
- `ensureFolio(reservationId)` — idempotent (FR-1). Called by 03.
- `ensureDirectSaleFolio(propertyId)` — idempotent; returns the open `DIRECT_SALE` house folio (`reservationId` null, `kind=DIRECT_SALE`), creating one if none open. Backs walk-in POS. (FR-25)
- `postFolioCharge(folioId, {type, description, qty, unitPaise, hsnSac, placeOfSupplyState?})` — resolves place of supply via `placeOfSupply(type, propertyState, billToState)` (property state for on-premise types), computes GST, inserts line, `FolioCharged`. Called by front desk, 19-POS. Canonical name — **not** `postCharge`. (FR-4)
- `postRoomCharges(propertyId, businessDate)` — idempotent room-night posting for all in-house folios; relies on the partial-unique index `FolioLine(folioId,businessDate) WHERE type='ROOM'` (database-setup.md) so a re-run posts nothing. Called by 14 night audit. (FR-5)
- `settlePosSaleDirect(in: DirectSaleInput)` — walk-in POS: `ensureDirectSaleFolio(propertyId)` → `postFolioCharge` line(s) → `recordPayment` → `generateInvoice` (gap-free) → returns `{invoiceId, paymentId}`. Called by 19. (FR-25)
- `applyDiscount(folioId, amountPaise, reason, {mode: 'PRE_TAX'|'FINANCIAL'})` — threshold (`SecuritySettings.discountThresholdPaise`) + `folio:discount`; builds the line via `discountLine(...)` (pre-tax negates proportional CGST/SGST; financial-only zeroes tax); `DiscountApplied`. (FR-6)
- `reverseFolioLine(lineId, reason)` — append-only `REVERSAL` line referencing `reversalOfId` with negated amount + tax; the POS-void/correction path (19 calls on `PosOrderVoided`); if the line is on an issued invoice, route to `voidInvoice` credit-note path. Canonical name — **not** `reverseLine`. Returns `{reversalLineId}`. (FR-7)
- `recordPayment(folioId, tenders[])` — 1..n `Payment` rows in one tx (split), sums validated, all sharing one `settlementBatchId`; emits one `PaymentReceived` carrying `settlementBatchId` + `tenders[]`. Returns `{batchId}`. (FR-8/9)
- `settleCorporate(folioId, corporateId)` — inside the settlement tx calls **`25.reserveCredit(corporateId, amountPaise)`** (atomic check-and-increment under row lock); on success records the `CORPORATE_CREDIT` `Payment` and emits `CorporateReceivableChanged`; on limit breach the whole tx rolls back (`CREDIT_LIMIT_EXCEEDED`). No check-then-act. (FR-17)
- `startOnlinePayment(folioId, amountPaise)` + webhook handler `/api/webhooks/payments` — provider order + signature-verified capture, inbox-deduped. (FR-11)
- `refund(folioId, amountPaise, reason)` — `folio:refund`; `refundWithinNetPaid` guard; writes `Payment(isRefund=true, amountPaise>0)`; `PaymentRefunded`. (FR-10)
- `generateInvoice(folioId, billTo, type?)` — **short tx**: `financialYearOf(date)` → get-or-create `InvoiceSeries(propertyId, FY)` → `SELECT … FOR UPDATE` allocate number → compute totals → INSERT `Invoice` (`pdfObjectKey` null) → `InvoiceIssued` → COMMIT; **then** render PDF → storage → set `pdfObjectKey`. Credit notes (`type=CREDIT_NOTE`) draw the **same series**. (FR-12/13/16)
- `voidInvoice(invoiceId, reason)` — `invoice:void` (🔒); records a `CREDIT_NOTE` (`cancelsInvoiceId` set) drawing the **same `InvoiceSeries`**, gap-free preserved, original never deleted/renumbered. (FR-21)

## Queries (`features/billing/queries.ts`)
`getFolio(id)` (lines+payments+derived balance), `getBalance(reservationId)` (for 03 checkout gate, FR-18), `revenueByCategory(range, propertyId)` + `outstanding(range)` (for 08/14, net-of-discount, tax-excluded, FR-24).
- `corporateReceivable(corporateId)` — the **only** read path for 25 to see the receivable this module records (FR-17/26); reconciles with the `CORPORATE_CREDIT` payments and `CorporateReceivableChanged` events. No foreign SELECT by 25.
- `guestBilling(guestId)` — **guest-scoped** roll-up of a guest's folios (revenue net-of-discount tax-excluded, outstanding, invoice/bill links) across all their reservations, exposed for **05-guest-history** to derive stats in **one call** instead of fanning out per reservation. Same derivation as `revenueByCategory`/`outstanding` so 05 reconciles to the paisa with 14 (FR-24).

## UI — wireframes (mobile-first, `features/billing/components/`)
**Folio screen** (line amounts shown **GST-inclusive**; totals reconcile exactly — `12,000 + 1,180 − 500 = 12,680`):
```
┌────────────────────────────────┐
│ Folio · Ravi Kumar R-101       │
│ Room 4,000×3 (incl 12%) 12,000 │
│ Laundry     (incl 18%)   1,180 │
│ Discount    (pre-tax)   −  500 │
│ ── total (incl GST) ──   12,680│
│ Paid (UPI 5,000)        − 5,000│
│ Balance due             ₹7,680 │
│ [+ Charge] [Take payment]      │
│ [Generate GST invoice]         │
└────────────────────────────────┘
```
*Discount GST treatment (FR-6):* the −500 shown is a **pre-tax** `DISCOUNT` line — it reduces the taxable value and carries negated proportional CGST/SGST, so the GST folded into the displayed line amounts is already net of it; the sum of the displayed amounts is the payable total. (A **financial-only** discount would instead be a flat −500 with zero tax.) The invoice preview breaks this out into taxable value + tax so the printed CGST/SGST reconciles with the folio.
**Take payment (split):** amount, then add tenders (UPI/Card/Cash…) each with amount; running "remaining" must reach 0 to enable Confirm; all tenders post under one `settlementBatchId`. **Invoice preview:** GST layout with breakup + total-in-words; "Download / WhatsApp / Email" (via 12).

## Events
Emits: `FolioCharged`, `DiscountApplied`, `PaymentReceived` (payload `{folioId, settlementBatchId, tenders[]{mode, amountPaise}}` per the catalog — so 22/12 reconcile the batch from the event), `PaymentRefunded`, `InvoiceIssued`, `PaymentDueDetected`, `CorporateReceivableChanged` (on `CORPORATE_CREDIT` settlement → 25). Consumed by 05/08/14/12/22/25. Catalog: `docs/architecture/domain-events.md`.

## Sequences
**Generate invoice (short tx + PDF after commit):** BEGIN → `financialYearOf(date)` (1 Apr boundary) → get-or-create `InvoiceSeries(propertyId,FY)` → `SELECT … FOR UPDATE` on the series → allocate number → compute totals → INSERT Invoice(number, `pdfObjectKey=null`) → emit `InvoiceIssued` + audit → **COMMIT**. *After commit:* render PDF → object storage → set `pdfObjectKey` (retryable, idempotent). A numbering-tx rollback ⇒ number not consumed (FR-14); a post-commit render failure ⇒ invoice valid, PDF retried, no gap. **Void:** `CREDIT_NOTE` drawing the same series via the identical path.
**Corporate settlement (atomic):** BEGIN → `25.reserveCredit(corporateId, amount)` (row lock, check-and-increment) → if over limit ROLLBACK (`CREDIT_LIMIT_EXCEEDED`) → else INSERT `Payment(CORPORATE_CREDIT)` → emit `CorporateReceivableChanged` + audit → COMMIT. 25 later reads via `corporateReceivable(corporateId)`.
**Walk-in POS (direct sale):** 19 calls `settlePosSaleDirect(in)` → `ensureDirectSaleFolio(propertyId)` (house folio, `reservationId` null) → `postFolioCharge` line(s) (place of supply = property state) → `recordPayment` → `generateInvoice` → returns `{invoiceId, paymentId}`.
**Online payment:** create provider order (sandbox if no creds) → guest pays → webhook (verify signature) → inbox dedupe → `recordPayment` → `PaymentReceived`.
**Night-audit posting (idempotent):** 14 calls `postRoomCharges(prop, date)` → for each in-house folio, insert one ROOM line for `date`; the partial-unique index `FolioLine(folioId,businessDate) WHERE type='ROOM'` makes a re-run's duplicate insert conflict and be skipped → GST by tariff slab.

## Error catalog
`INVALID_AMOUNT`, `SPLIT_MISMATCH`, `REFUND_EXCEEDS_PAID`, `DISCOUNT_OVER_THRESHOLD`, `CLOSED_DATE_POSTING`, `CREDIT_LIMIT_EXCEEDED`, `SERIES_LOCK_TIMEOUT`, `FORBIDDEN`, `WEBHOOK_SIGNATURE_INVALID`.

## Edge cases
- Concurrent invoice generation → row-locked series serializes them; gap-free guaranteed (AC-14). PDF render is outside the lock, so it never serializes numbering.
- First invoice of a new FY → `InvoiceSeries` row is created on demand inside the numbering tx; the 1 Apr boundary (`financialYearOf`) decides which FY a late-March vs early-April invoice lands in.
- Webhook arrives before order row is committed → inbox holds it; processed once order exists.
- Reversal of a line already on an issued invoice → **credit-note path** (same series), not a silent edit.
- **GST-MH bill-to for an on-premise service** → still **CGST+SGST** (place of supply = property state); a Maharashtra billing address does **not** make room/F&B/laundry inter-state. IGST only for a rare genuine off-premise supply.
- Rounding: line-level half-up; CGST/SGST rounded independently → their sum may differ from a single 18% rounding by ≤1 paisa — this is correct per rule, tested explicitly.
- Two concurrent `CORPORATE_CREDIT` settlements near the limit → `reserveCredit`'s row lock serializes them; only the amount that fits is admitted, the other rolls back — no over-limit race.
- Corporate settlement then later part-cash → mixed; receivable adjusts.
- Refund after checkout → allowed; `Payment(isRefund, amountPaise>0)` adds back to balance; emits event; accounting-sync reflects.
