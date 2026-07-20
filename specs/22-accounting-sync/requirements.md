# 22 · Accounting Sync — Requirements

> Source: client doc §19 (Tally / Zoho Books integration). Read with `rules/integrations.md` (provider abstraction, sandbox↔live, idempotency), `prisma/schema.prisma` (`AccountingSyncLog`). Depth bar: `specs/03-reservations/*`.

## Purpose & scope
Push invoices, payments, expenses, and payroll cost to an external accounting system (Tally / Zoho Books) via an `AccountingProvider` abstraction, idempotently and reliably, driven by domain events. Runs in sandbox with no credentials; going live is a config change gated on the client's accounting account.

**In scope:** `AccountingProvider` interface (pushInvoice/pushExpense/pushPayment/reconcile); event-driven sync of `InvoiceIssued`/`PaymentReceived`/`PaymentRefunded`/`ExpenseRecorded`/`PayrollFinalized`; `AccountingSyncLog` with idempotency + status; retry/backoff/dead-letter; reconciliation view.
**Out of scope:** the financial data itself (06/07/21 own it); the accounting system's own ledger logic; a full double-entry engine on our side (we push documents, the accounting system journals them).

## Dependencies
- **Tier 0:** 00 (events, audit, pg-boss, inbox), 01.
- **Consumes events from:** 06 (invoice/payment/refund), 07 (expense), 21 (payroll cost).
- A module depends only on lower/equal tiers; reaches others via events, not foreign SELECTs.

## Data owned
`AccountingSyncLog` (unique `(provider, entityType, entityId)`) and `AccountingConfig(orgId, provider, mode, credentialsRef, glMappings)` — **both confirmed present in the canonical schema**.

## Functional requirements (EARS)
- **FR-1 (ubiquitous):** Provide an `AccountingProvider` interface (`pushInvoice`, `pushExpense`, `pushPayment`, `reconcile`) with adapters for Tally and Zoho Books + a **mock** (default); application code depends on the interface only.
- **FR-2 (event):** When `InvoiceIssued`/`PaymentReceived`/`PaymentRefunded`/`ExpenseRecorded`/`PayrollFinalized` occurs, enqueue a sync job that pushes the document to the active provider and records an `AccountingSyncLog`. Consume these **settled finance events only — never raw `FolioCharged`** (avoids double entries: the accounting system journals off issued invoices / received payments / recorded expenses / finalized payroll, not per-folio-line charges — `domain-events.md`).
- **FR-3 (ubiquitous):** Each push is **idempotent** — keyed by `(provider, entityType, entityId)`; a re-run does not create a duplicate in the accounting system (store the returned `externalId`).
- **FR-4 (state):** While in **sandbox** (no live credentials), record the intended push to the log as `SANDBOX`/success with a fake `externalId`, performing no external call — the whole flow runs end-to-end.
- **FR-5 (unwanted):** If a push fails, retry with backoff via pg-boss; after the cap, dead-letter with `status=FAILED` + admin alert — never lose the document; front-desk/finance operations are unaffected.
- **FR-6 (ubiquitous):** Provide a reconciliation view: which documents are synced/pending/failed per provider + last sync time.
- **FR-7 (ubiquitous):** Config (provider, mode, credentials, GL mappings) is `AccountingConfig` so switching Tally↔Zoho or going live is a **config change, not code**.
- **FR-8 (ubiquitous):** All sync operations are org/property-scoped, authorized (`integration:manage` to configure), and audited.

## Non-functional (cited)
Sync is async off the write path; idempotent + retried; sandbox runs with zero external accounts; reconciliation within list budgets. (`non-functional-requirements.md`, `integrations.md`)

## Business rules referenced
`integrations.md` (interface-behind-provider, sandbox↔live, idempotency, retry/dead-letter, honest live blocker = client's accounting account/OAuth), `business-rules.md` §20.
