# 06 · Billing & Payments — Tasks

The money core — highest test rigor. Test-first for ALL domain fns. Each ends at `rules/definition-of-done.md`. `(AC-n)/(FR-n)` = traceability.

## Schema & migration
- [x] T-1 Materialize the `Folio/FolioLine/Payment/InvoiceSeries/Invoice` slice — all **confirmed present in canonical schema**: `Invoice.type/cancelsInvoiceId`, nullable `Invoice.pdfObjectKey`, `FolioLine.placeOfSupplyState`, `Payment.settlementBatchId`, positive `Payment.amountPaise`+`isRefund`, `Folio.kind`+nullable `Folio.reservationId`, and **BigInt** money on `FolioLine/Payment/Invoice` (nothing "new"); migration + indexes incl. the partial-unique night-audit index. (FR-2/8/12/21/25)
- [x] T-2 DB guards: append-only enforcement (no UPDATE/DELETE that changes meaning) via triggers/permissions; unique `Invoice(propertyId,number)`; check constraints amount>0. (FR-2/13/23)
- [x] T-3 `lib/constants/gst.ts` (tariff band→bps, HSN/SAC→rate). Seed fixtures. (FR-11)

## Domain (write tests FIRST — exhaustive)
- [x] T-4 `placeOfSupply` (on-premise types → property state) + `computeGst` intra (CGST=SGST) vs inter (IGST); on-premise service with a Maharashtra bill-to still resolves CGST+SGST; independent half-up rounding. (FR-4/19, AC-3/4/5)
- [x] T-5 `folioBalance` derivation across charges/tax/payments/**refunds added back**/discounts/reversals; `Payment.amountPaise` positive + `isRefund` direction. (FR-3/10, AC-2)
- [x] T-6 `roundPaiseHalfUp`, `splitSumsTo`, `refundWithinNetPaid` (net = Σ non-refund − Σ refund), `discountLine` (pre-tax vs financial-only), `financialYearOf` (1 Apr boundary). (FR-6/8/10/12/19/23, AC-8/9/11)
- [x] T-7 `amountInWords` (Indian numbering). (FR-16, AC-16)

## Application (integration tests vs test DB)
- [x] T-8 `ensureFolio` idempotent. (FR-1, AC-1)
- [x] T-9 `postFolioCharge` (canonical name, **not** `postCharge`) GST line + event + audit; place of supply = property state for on-premise types. (FR-4, AC-3/4)
- [x] T-10 `applyDiscount` pre-tax (negated proportional CGST/SGST) vs financial-only; threshold (`SecuritySettings.discountThresholdPaise`) + permission + audited override. (FR-6, AC-6)
- [x] T-11 `reverseFolioLine` (canonical name, **not** `reverseLine`) append-only reversal; POS-void/correction path; on-invoice line routes to credit note. (FR-7, AC-7)
- [x] T-12 `recordPayment` split in one tx, sum-validated, shared `settlementBatchId`, one `PaymentReceived` carrying `settlementBatchId`+`tenders[]`. (FR-8/9, AC-8/9/10)
- [x] T-13 `refund` within net-paid + permission. (FR-10, AC-11/23)
- [x] T-14 `startOnlinePayment` + webhook: signature verify + inbox dedupe + record. (FR-11, AC-12)
- [x] T-15 `generateInvoice` short-tx numbering (get-or-create series, `financialYearOf` 1 Apr boundary) + `InvoiceIssued`; **PDF rendered AFTER commit**, `pdfObjectKey` set on follow-up; render <3s. (FR-12/16, AC-13/16)
- [x] T-16 Concurrency: two invoices → gap-free, no dup (row lock). (FR-13, AC-14)
- [x] T-17 Rollback mid-numbering → number NOT consumed, no Invoice row; post-commit render failure → invoice valid, `pdfObjectKey` null, retried, no gap. (FR-14, AC-15)
- [x] T-18 `voidInvoice` → `CREDIT_NOTE` on the **same `InvoiceSeries`** (`cancelsInvoiceId` set), gap-free, 🔒 audited. (FR-21, AC-17)
- [x] T-19 `postRoomCharges` idempotent room-night posting via partial-unique index `FolioLine(folioId,businessDate) WHERE type='ROOM'`. (FR-5, AC-18)
- [x] T-20 Closed-date guard: read `Property.currentBusinessDate`; reject back-dated; audited adjustment to the open date. (FR-15, AC-19)
- [x] T-21 `PaymentDueDetected` on positive balance at checkout/close. (FR-20, AC-20)
- [x] T-22 `settleCorporate` calls `25.reserveCredit` **atomically inside the settlement tx** (row lock); reject over limit (whole tx rolls back); emit `CorporateReceivableChanged`. (FR-17, AC-21)
- [x] T-22b `settlePosSaleDirect` walk-in: `ensureDirectSaleFolio` (idempotent house folio) → charge → payment → gap-free invoice → returns `{invoiceId, paymentId}`. (FR-25, AC-26)
- [x] T-23 `getBalance` for 03 checkout gate; `corporateReceivable` for 25 (no foreign SELECT); `guestBilling` guest-scoped roll-up for 05. (FR-18/26, AC-22)
- [x] T-24 RBAC denials (refund/void/discount without perm). (FR-22, AC-23)
- [x] T-25 `revenueByCategory`/`outstanding`/`guestBilling` reconcile exactly with folios. (FR-24, AC-24)

## UI (mobile-first)
- [x] T-26 Folio screen (charges/payments/derived balance). (AC-2)
- [x] T-27 Take-payment split flow (remaining→0 to confirm). (AC-8)
- [x] T-28 GST invoice preview + download/WhatsApp/email. (AC-16)

## Coupons (§11)
- [x] T-C1 Confirm `Coupon`/`CouponRedemption` slice (**present in canonical schema**); migration + indexes (`@@unique([orgId,code])`, `@@unique([couponId,reservationId])`, `@@index([couponId,guestId])`). (FR-27)
- [x] T-C2 Domain `computeCouponDiscount` (percent+cap vs fixed; min-booking gate) — tests first. (FR-27, AC-27)
- [x] T-C3 `createCoupon/pauseCoupon/expireCoupon` (`coupon:manage`) + `validateCoupon` (no side effects). (FR-27, AC-27/31)
- [x] T-C4 `applyCoupon` ATOMIC (row-lock coupon → re-check → increment `timesUsed` → `CouponRedemption` → pre-tax `DISCOUNT` line + GST recompute → `CouponRedeemed`). (FR-28, AC-28)
- [x] T-C5 Concurrency test: last-use coupon applied by two guests → exactly one wins, other `COUPON_EXHAUSTED`. (FR-28, AC-29)
- [x] T-C6 Invalid/expired/ineligible/per-guest-limit/min-booking rejections. (FR-29, AC-30)

## E2E
- [x] T-29 Journey: charge → discount → split payment → generate GST invoice → verify totals + numbering. (AC-3/6/8/13/16)
- [ ] T-29b Journey: walk-in POS → `settlePosSaleDirect` → verify `DIRECT_SALE` folio, CGST+SGST, gap-free invoice, `{invoiceId, paymentId}`. (AC-26)
- [ ] T-29c Journey: create coupon → redeem at checkout → verify DISCOUNT line + GST recompute + `timesUsed`++ + `CouponRedeemed`. (AC-27/28)

## Done
- [x] T-30 `/review-module` clean; every AC → green test; reconciliation test passes; DoD satisfied. Money module — no `PLAUSIBLE`-only coverage; all money paths CONFIRMED by tests.
