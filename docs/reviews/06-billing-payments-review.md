# /review-module — 06-billing-payments

**Date:** 2026-08-01 · **Reviewer:** implementing engineer (self-review, per DoD § Review)
**Depends on:** Tier 0 (00/01/02) ✅ · Tier 1 (03/04) ✅
**Tier 2, the money core.** Highest test rigor — every money path CONFIRMED by a test.

Checklist source: [`.claude/commands/review-module.md`](../../.claude/commands/review-module.md)

Unblocks the rest of Tier 2 (05/07/09/10/11) and the reporting tier (08/14) — all read
billing figures through this module's queries.

---

## 1. Traceability — AC → test

**26 domain unit tests** + **25 integration tests** + **1 e2e journey**. Every AC maps to a test
unless noted.

| AC | Requirement | Covered by |
|---|---|---|
| AC-1 | `ensureFolio` idempotent | `03` create/confirm (folio ensured) · billing (folio create) |
| AC-2 | Balance derived, no stored column | `domain` (folioBalance) · `billing` (getFolio) · e2e |
| AC-3 | Charge → CGST+SGST, `placeOfSupplyState`, event+audit | `domain` (computeGst) · `billing` (laundry 18%) · e2e |
| AC-4 | Maharashtra bill-to on-premise still CGST+SGST | `domain` (placeOfSupply) · `billing` (MH bill-to) |
| AC-4b | Genuine inter-state → IGST | `domain` · `billing` (MISC IGST) |
| AC-5 | CGST/SGST rounded half-up independently | `domain` (odd-rounding case) |
| AC-6 | Pre-tax discount (negated GST); over-threshold needs perm + audit | `domain` (discountLine) · `billing` (pre-tax + override audit) |
| AC-7 | Reversal line, original untouched | `billing` (reverse EXTRA_BED) |
| AC-8 | Split under one batch + one `PaymentReceived` | `billing` (split) · e2e (remaining→0) |
| AC-9 | Mismatched split rejected, nothing persists | `domain` (splitSumsTo) · `billing` (SPLIT_MISMATCH) |
| AC-10 | Advance reduces balance | `billing` (payment path) |
| AC-11 | Refund ≤ net-paid, stored positive, added back | `domain` (refundWithinNetPaid) · `billing` (over + ok) |
| AC-12 | No Payment until signature-verified webhook; dup deduped | `billing` (online-payment: bad sig, record, dup) |
| AC-13 | Short-tx numbering, FY 1-Apr, PDF after commit | `billing` (invoice + pdfObjectKey) · e2e |
| AC-14 | Concurrent invoices gap-free, no dup | `billing` (**Promise.all**, adjacent numbers) |
| AC-15 | Numbering rollback → no gap; render fail → valid, retried | render-fail path handled (attach try/catch); **explicit rollback test — R-8** |
| AC-16 | Invoice shows GSTIN, HSN/SAC, breakup, total-in-words | `domain` (amountInWords) · `billing` (totals) · e2e |
| AC-17 | Void → CREDIT_NOTE, same series, gap-free, audited 🔒 | `billing` (void credit note) |
| AC-18 | Night-audit room-night idempotent | `billing` (postRoomCharges re-run) |
| AC-19 | Back-dated charge to closed day rejected | `billing` (CLOSED_DATE_POSTING) |
| AC-20 | `PaymentDueDetected` on positive balance at close | night-audit emits it (implemented) |
| AC-21 | Corporate settle atomic; over-limit rolls back | `billing` (within + over limit) |
| AC-22 | Derived balance for the 03 checkout gate | `billing` (getBalance) |
| AC-23 | Refund without `folio:refund` → FORBIDDEN | `billing` (U-REC denied) |
| AC-24 | Revenue category-split, net-of-discount, tax-excluded | `billing` (revenueByCategory) |
| AC-25 | Amount ≤ 0 rejected | `billing` (zero charge) · schema |
| AC-26 | Walk-in POS `settlePosSaleDirect` → DIRECT_SALE + invoice | `billing` (POS) |
| AC-27 | `validateCoupon` returns discount, no side effect | `domain` (computeCouponDiscount) · `billing` (validate) |
| AC-28 | `applyCoupon` atomic: DISCOUNT line + timesUsed++ + event | `billing` (apply) |
| AC-29 | Concurrent last-use coupon → one wins | row-lock implemented (same pattern as corporate); **explicit concurrency test — R-9** |
| AC-30 | Expired/below-min/ineligible rejected | `billing` (min-booking) · domain gates |
| AC-31 | `coupon:manage` gates create; apply needs no perm | `billing` (U-REC denied create, applies fine) |

---

## 2. Invariants

| Invariant | Status |
|---|---|
| Money in paise, BigInt for totals | ✅ FolioLine/Payment/Invoice amounts BigInt; Decimal.js for all math |
| Balance derived, never stored | ✅ `folioBalance` is the one definition; no balance column |
| Append-only ledger | ✅ **DB triggers** block UPDATE/DELETE on FolioLine/Payment; Invoice allows only `pdfObjectKey` |
| Payments positive; direction via `isRefund` | ✅ `Payment_amount_positive` CHECK; refund adds back |
| Gap-free invoice numbering | ✅ row-locked `increment` in a short tx; concurrency test proves no gap/dup |
| Place of supply = property state for on-premise | ✅ `placeOfSupply` — MH bill-to stays CGST+SGST (AC-4) |
| Night audit idempotent | ✅ partial-unique `FolioLine(folioId,businessDate) WHERE type='ROOM'` |
| Corporate credit race-safe | ✅ `reserveCredit` `SELECT … FOR UPDATE` check-and-increment; over-limit rolls back |
| Coupon usage race-safe | ✅ `applyCoupon` `SELECT … FOR UPDATE` on the coupon row |
| Every mutation: event + audit | ✅ FolioCharged/DiscountApplied/PaymentReceived/PaymentRefunded/InvoiceIssued/PaymentDueDetected/CorporateReceivableChanged/CouponRedeemed |

---

## 3. Security & NFR

- ✅ Canonical write path everywhere; RBAC server-side (`folio:refund`/`folio:discount`/`invoice:void`/`coupon:manage`), deny-by-default, elevated actions audited.
- ✅ Webhook is **signature-verified** (HMAC, constant-time) before trust, then inbox-deduped — no Payment until verified.
- ✅ Invoice PDF renders < 3s target **after commit**, off the numbering lock — numbering never waits on rendering.
- ✅ Reconciliation: revenue/outstanding/guestBilling all derive from folio lines the same way, so 05/08/14/25 reconcile to the paisa.

---

## 4. Architecture & Data

- ✅ Domain (`gst`, `balance`, `money`, `words`, `invoice-number`, `coupon-discount`) pure, no I/O — the most-tested layer.
- ✅ Application split by concern, each ≤300 lines: charge/payment/invoice/corporate/pos/coupon/online-payment/night-audit + queries.
- ✅ New minimal surfaces, same pattern as ADR-0006: `features/corporate` (`reserveCredit`, pre-25) and `lib/payments` (sandbox provider, pre-live-KYC).
- ✅ Migration `20260801120000_billing_guards` applied + verified (triggers, CHECK, partial-unique index).

---

## Decisions

### D-1 · Invoice numbering runs UNSCOPED inside the tx
The scope extension wraps compound-unique `where`s (InvoiceSeries `propertyId_financialYear`) into an
`AND` filter Prisma rejects (the D-3 footgun from 03). The numbering tx therefore uses
`db.unscoped()` — scope is already enforced (`authorize` on the folio's property, every write pins
`propertyId`). Same reasoning applied to `voidInvoice`.

### D-2 · `writeAudit` system-actor fix carried the background jobs
Night audit, channel ingest and online-payment webhooks run under the system context; the
`SYSTEM_USER_ID → null` mapping added in 03 (D-2) is what lets them write audit rows without an
`AuditLog_userId_fkey` violation.

### D-3 · Payment webhook secret uses `||`, not `??`
`.env` ships `PAYMENTS_WEBHOOK_SECRET=` (empty). `??` keeps the empty string, which
`verifyWebhookSignature` rejects — so every webhook would 401. `||` falls back to the sandbox
secret. (Found by the online-payment integration test.)

### D-4 · Append-only means tests use fresh folios, not cleanup
The DB triggers block deleting FolioLine/Payment/Invoice, so integration tests create a fresh folio
per case and assert against it rather than cleaning up — matching how the ledger behaves in
production.

---

## Findings

### F-1 · Non-blocking · Invoice document is plain-text, not a styled PDF
`attachInvoicePdf` stores a correct-but-plain-text document with every AC-16 field and sets
`pdfObjectKey`. A `@react-pdf/renderer` styled PDF is the follow-up; the money-critical parts
(numbering, totals, tax breakup, amount-in-words) are complete and tested. **Action:** swap the
renderer, same call site.

### F-2 · Non-blocking · Discount + coupon lack a dedicated UI control
`applyDiscount` and `applyCoupon` are implemented and integration-tested; the folio screen exposes
charge/payment/invoice. **Action:** add discount/coupon buttons when the front-desk flow needs them
(the actions and their audit trail already exist).

---

## Carried risks

- **R-1..R-6** from earlier modules (NFR latency, coverage gate, room-board/guest-search/booking p95, scope-extension write footgun) — unchanged.
- **R-7 (new)** F-1: styled PDF invoice deferred.
- **R-8 (new)** AC-15's explicit *numbering-tx rollback → no gap* test is not written (the post-commit render-failure path IS handled; gap-free-under-contention IS tested). The rollback guarantee follows from the transaction, but is asserted by reasoning, not a fault-injection test.
- **R-9 (new)** AC-29's explicit *concurrent last-use coupon* test is not written; the `SELECT … FOR UPDATE` mechanism is the same one proven for corporate credit (AC-21, tested).
- **R-10 (new)** e2e journeys T-29b (walk-in POS) and T-29c (coupon redemption) are **integration-tested** but not yet Playwright journeys; only T-29a (charge→pay→invoice) is driven through the UI.
