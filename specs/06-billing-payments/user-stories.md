# 06 · Billing & Payments — User Stories & Acceptance Criteria

Roles per `rules/user-roles.md`. Money in paise; every figure reconciles to the folio.

## Test Fixtures
| Ref | Entity | Value |
|---|---|---|
| PROP-A | Property | Karnataka, GSTIN `29ABCDE1234F1Z5`, invoice prefix `WMG`, FY `2026-27` |
| CAT-DLX | RoomCategory | Deluxe, HSN `996311`, tariff ₹4,000 → GST slab 12% (1200 bps) |
| RES-1 | Reservation | G-RAVI, Deluxe, 12–15 Jul (3 nights), rate ₹4,000, CONFIRMED |
| GST-KA | Customer | Karnataka bill-to (same as PROP-A state) → CGST+SGST |
| GST-MH | Customer | **Maharashtra bill-to** — on-premise service still **CGST+SGST** (place of supply = PROP-A's state, Karnataka); bill-to state does NOT trigger IGST |
| ISS-1 | Charge | rare **genuine inter-state** supply (place of supply ≠ property state, e.g. goods dispatched out-of-state) → IGST |
| DS-1 | Direct sale | walk-in POS, **no reservation** → `DIRECT_SALE` house folio |
| ACME | Corporate | credit limit ₹200,000 |
| U-REC | User | RECEPTION (`folio:charge`, `payment:record`, `invoice:generate`) |
| U-ACC | User | ACCOUNTS (+ `folio:refund`, `folio:discount`, `invoice:void`) |
| CLOCK | Injected clock | fixed business date for night-audit tests |

## US-1 — Folio lifecycle
- **AC-1:** Given RES-1 confirmed, when `ensureFolio(RES-1)` is called (by 03), then exactly one `Folio` exists; a second call is a no-op (idempotent). (FR-1)
- **AC-2:** Given a folio, when I read its balance, then it equals `Σ(line + taxes) − Σ(payments)` computed live — there is no stored balance column. (FR-3)

## US-2 — Charges & GST
- **AC-3:** Given a ₹1,000 laundry charge on PROP-A at 18% (1800 bps), when posted, then a `FolioLine` stores amount 100000 paise, CGST 9000, SGST 9000 (each half-up, independent) with `placeOfSupplyState` = PROP-A's state, `FolioCharged` emitted + audited. (FR-4/19)
- **AC-4:** Given **GST-MH (Maharashtra bill-to)**, when the same on-premise laundry charge posts, then it is still **CGST 9000 + SGST 9000, no IGST** — the place of supply for an on-premise service is the **property's state**, so a different bill-to state does **not** make it inter-state. (FR-4)
- **AC-4b:** Given **ISS-1**, a rare genuine inter-state supply (place of supply ≠ property state), when the ₹1,000 charge posts, then IGST 18000, no CGST/SGST. (FR-4)
- **AC-5:** Given a ₹1,000 charge at 12%, when the paisa rounds, then CGST and SGST are each rounded half-up independently and their sum matches the line tax. (FR-19)

## US-3 — Discounts & reversals (append-only)
- **AC-6:** Given U-REC applies a ₹500 discount within threshold, when posted, then a negative `DISCOUNT` line is written — **pre-tax by default** (reduces taxable value with negated proportional CGST/SGST; a financial-only discount instead carries zero tax); a ₹3,000 discount over threshold (`SecuritySettings.discountThresholdPaise`) without `folio:discount` is rejected; U-ACC with the permission succeeds + audited override. (FR-6)
- **AC-7:** Given a wrongly-posted ₹800 extra-bed line, when corrected, then a `REVERSAL` line referencing `reversalOfId` with amount −800 and negated tax is inserted — the original is never edited/deleted. (FR-7)

## US-4 — Payments, split, advance, refund
- **AC-8:** Given a ₹13,410 balance, when settled as ₹5,000 UPI + ₹8,410 CARD in one action, then two `Payment` rows are written in one transaction sharing one `settlementBatchId` and summing to 13,410; exactly one `PaymentReceived` is emitted whose payload carries `settlementBatchId` + `tenders[]` (so 22/12 reconcile without re-reading rows). (FR-8)
- **AC-9:** Given a split whose parts sum to ₹13,000 (≠ 13,410), when submitted, then rejected, nothing persists. (FR-23)
- **AC-10:** Given RES-1 CONFIRMED, when a ₹5,000 advance is recorded, then balance drops by 5,000 and reconciles with `Reservation.advancePaise`. (FR-9)
- **AC-11:** Given ₹13,410 paid, when a ₹15,000 refund is attempted, then rejected (exceeds net paid = Σ non-refund − Σ refund); a ₹2,000 refund by U-ACC (`folio:refund`) writes `Payment(isRefund=true, amountPaise=200000 **positive**)` + `PaymentRefunded`, and the derived balance goes **up** by 2,000 (refund added back). (FR-10/23)

## US-5 — Online payment
- **AC-12:** Given online payment chosen, when the provider order is created (sandbox), then no `Payment` is recorded until a **signature-verified** webhook arrives; a duplicate webhook (same provider id) is deduped via inbox and records nothing extra. (FR-11)

## US-6 — GST invoice & numbering
- **AC-13:** Given a settled folio, when an invoice is generated, then in one **short transaction** the FY is derived from the invoice date (**1 Apr boundary** → `2026-27`), the `InvoiceSeries(PROP-A, 2026-27)` row is **created if it is the first invoice** of that FY, its next number is allocated under row lock alongside the `Invoice` insert (`pdfObjectKey` null), and `InvoiceIssued` is emitted; the **PDF renders to storage AFTER commit** (< 3s) and `pdfObjectKey` is set on the follow-up write. (FR-12)
- **AC-14:** Given two invoices generated concurrently, when both commit, then numbers are sequential and gap-free with no duplicates (row-locked series). (FR-13)
- **AC-15:** Given the invoice-**numbering** transaction fails midway, when it rolls back, then the series number is **not** consumed (no gap) and no `Invoice` row exists; and given the **post-commit PDF render** fails, then the `Invoice` stays valid with `pdfObjectKey` null and the render is retried — no numbering gap. (FR-14)
- **AC-16:** Given a generated invoice, then it shows gap-free number, property GSTIN, customer name (+GSTIN if B2B), place of supply, per-line HSN/SAC, taxable value, CGST/SGST or IGST breakup, grand total, and **total in words**. (FR-16)
- **AC-17:** Given an issued invoice, when U-ACC voids it, then it is not deleted/renumbered — a `CREDIT_NOTE` (`cancelsInvoiceId` set) is recorded drawing the **same `InvoiceSeries`**, numbering stays gap-free, action audited (🔒). (FR-21)

## US-7 — Night audit posting & closed days
- **AC-18:** Given RES-1 in-house on 12 Jul, when night audit posts for 12 Jul, then exactly one `ROOM` line of ₹4,000 + 12% GST is posted; a re-run posts nothing new (idempotent). (FR-5)
- **AC-19:** Given 12 Jul is closed, when a back-dated charge to 12 Jul is attempted, then rejected; an audited adjustment posts to the current open date referencing the original. (FR-15)
- **AC-20:** Given a positive balance at checkout/close, then `PaymentDueDetected` is emitted for 12 to remind. (FR-20)

## US-8 — Corporate credit & checkout gate
- **AC-21:** Given ACME within limit, when a folio settles on `CORPORATE_CREDIT`, then **`25.reserveCredit` is called atomically inside the settlement transaction** (row-lock check-and-increment) before the `Payment` is recorded, `CorporateReceivableChanged` is emitted, and 25 reads the receivable via `corporateReceivable(ACME)` (no foreign SELECT); a settlement exceeding the credit limit rolls the whole transaction back (nothing persists). Two concurrent near-limit settlements do not both pass (row lock serializes). (FR-17)
- **AC-22:** Given 03 requests checkout balance, then the derived balance is returned so 03 can block checkout unless settled/deferred. (FR-18)

## Permission / negative / reconciliation
- **AC-23:** Given U-REC (no `folio:refund`), when refunding, then `FORBIDDEN`. (FR-22)
- **AC-24:** Given 08/14 request revenue, then figures are category-split, net-of-discount, tax-excluded, and reconcile exactly with folios. (FR-24)
- **AC-25:** Given any amount ≤ 0 for charge/payment/refund, when submitted, then rejected, nothing persists. (FR-23)

## US-9 — Walk-in POS direct sale
- **AC-26:** Given DS-1 (a walk-in POS sale with **no reservation**), when 19 calls `settlePosSaleDirect`, then `ensureDirectSaleFolio(PROP-A)` returns the idempotent `DIRECT_SALE` house folio (`reservationId` null), the sale line posts with CGST+SGST (place of supply = PROP-A state), a `Payment` is recorded, a **gap-free GST invoice** is issued through the same numbering path, and the action returns `{invoiceId, paymentId}`. (FR-25)
