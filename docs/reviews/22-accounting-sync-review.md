# /review-module — 22-accounting-sync

**Date:** 2026-08-03 · **Reviewer:** implementing engineer (self-review, per DoD § Review)
**Built by:** delegated subagent (parallel Tier-6 batch); **integrated + verified serially by the parent.**
**Depends on:** 00 (events/consumer/alerts). **Consumes:** 06 (`InvoiceIssued`/`PaymentReceived`/`PaymentRefunded`), 07 (`ExpenseRecorded`), 21 (`PayrollFinalized`).
**Tier 6.** Owns `AccountingSyncLog`, `AccountingConfig`. Sandbox-by-default (zero external accounts).

## 1. Traceability — AC → test
**14 unit** + **9 integration** + **3 e2e**.

| AC | Requirement | Covered by |
|---|---|---|
| AC-1/2/3 | Enqueue → sandbox push + externalId; re-delivery no duplicate | integration · e2e |
| AC-4 | Retry → dead-letter + alert | integration (FAILED + alert once) |
| AC-5/6 | Consumers on 06/07/21 events | integration |
| AC-7 | Reconciliation view | integration · e2e |
| AC-8/12 | `configureAccounting` RBAC (`integration:manage`) | integration · e2e (reception 403) |
| AC-9 | invoice→INVOICE, void→CREDIT_NOTE, refund→REFUND | `to-accounting-doc` unit |
| AC-10 | Idempotent retry clears | integration |
| AC-11 | **`FolioCharged` NOT consumed** (no double entries) | integration (consumer types assertion) |

## 2. Invariants
| Invariant | Status |
|---|---|
| No double entries | ✅ consumes the invoice/payment/expense/payroll events, **never raw `FolioCharged`** (explicit test) |
| Idempotent push | ✅ `AccountingSyncLog @@unique([provider,entityType,entityId])` + `syncKey`; re-delivery → one row, unchanged externalId |
| Provider behind interface, mock default | ✅ `lib/accounting`; live (zoho/tally) refuses + names blocker |
| Ops never blocked | ✅ enqueue off the request path; `syncWorker` pushes; FAILED = dead-letter surface, admin-alerted once, retriable |
| Reads, never writes, other modules | ✅ reads invoice/expense/payment/payrollRun via `db.unscoped()` (documented); writes only its own tables |

## Decisions
- **D-1:** consumer *enqueues* a PENDING log (fast, off-path); `syncWorker` performs the idempotent push (channels-exemplar reliability).
- **D-2:** payment `syncKey` = settlementBatchId (received) / paymentId (refund) — distinct reloadable docs, avoids folio-id collision.
- **D-3:** teardown is append-only-aware (Invoice/Payment persist; per-run-unique `SLOT` ids avoid collision) — fixed at merge.

## Carried risks
- **R-40** No `attempts` column on `AccountingSyncLog`, so a strict capped backoff isn't stored — FAILED is the dead-letter surface (alert once + manual retry + pg-boss job retry). A true capped backoff needs a schema column.
- **R-41** System/worker reads use `db.unscoped()` (06/07/21 expose no system-context readers) — consistent with 13-channels; a future system-safe reader would remove the direct reads.
- **R-42** Live Zoho (OAuth app on the client's Books org) / Tally (connector on the client machine) pending client onboarding — sandbox/mock runs end-to-end.
