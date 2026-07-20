# 22 · Accounting Sync — User Stories & Acceptance Criteria

Roles per `rules/user-roles.md`. Event-driven, idempotent, sandbox-by-default.

## Test Fixtures
| Ref | Value |
|---|---|
| PROV | provider `zoho`, mode `sandbox` (mock adapter) |
| INV-1 | Invoice WMG/26-27/014, ₹13,410 (from 06) |
| EXP-1 | Expense Kitchen ₹1,200 (from 07) |
| PAY-1 | PayrollFinalized July cost ₹50,481 (from 21) |
| U-ADMIN | ADMINISTRATOR (`integration:manage`) |

## US-1 — Provider abstraction & sandbox
- **AC-1:** Given PROV sandbox (no creds), when `InvoiceIssued(INV-1)` fires, then a sync job records an `AccountingSyncLog(SANDBOX success)` with a fake externalId and makes no external call. (FR-1/4)
- **AC-2:** Given live Zoho credentials configured, when the job runs, then `AccountingProvider.pushInvoice` is called and the returned externalId is stored. (FR-1/2)

## US-2 — Idempotency & reliability
- **AC-3:** Given INV-1 already synced (externalId stored), when the event re-delivers or the job re-runs, then no duplicate is created in the accounting system (keyed on `(provider, Invoice, INV-1)`). (FR-3)
- **AC-4:** Given a push fails, when retried, then backoff up to the cap, then `FAILED` + admin alert; the document is never lost; finance ops unaffected. (FR-5)

## US-3 — Coverage
- **AC-5:** Given `ExpenseRecorded(EXP-1)` and `PayrollFinalized(PAY-1)`, when they fire, then each is pushed + logged (expense + salary journal). (FR-2)
- **AC-6:** Given payments/refunds, then `PaymentReceived`/`PaymentRefunded` sync too. (FR-2)

## US-4 — Reconciliation & config
- **AC-7:** Given synced/pending/failed documents, when U-ADMIN opens reconciliation, then per-provider status + last-sync time are shown. (FR-6)
- **AC-8:** Given U-ADMIN switches provider Tally↔Zoho or flips to live, then it is a config change (no code); non-admins are denied. (FR-7/8)

## US-5 — Correctness edge cases
- **AC-9:** Given a `PaymentRefunded` or an invoice **void/credit-note**, when synced, then a **credit/adjustment doc** is pushed (not a second invoice). (FR-2)
- **AC-10:** Given a push fails past the retry cap, then it is **dead-lettered `FAILED` + admin alerted**; when the admin retries after fixing credentials, it syncs and clears — **idempotent** (no duplicate in the accounting system). (FR-5/3)
- **AC-11:** Given raw `FolioCharged` events fire, then 22 does **not** consume them (only `InvoiceIssued` / `PaymentReceived` / `PaymentRefunded` / `ExpenseRecorded` / `PayrollFinalized`) — **no double entries**. (FR-2)
- **AC-12:** Given a non-admin, when configuring accounting or triggering a sync, then `FORBIDDEN`. (FR-8)
