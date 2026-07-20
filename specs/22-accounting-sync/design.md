# 22 · Accounting Sync — Design

## Schema slice (from canonical `prisma/schema.prisma`)
Owns `AccountingSyncLog` (unique `(provider, entityType, entityId)`) and `AccountingConfig(orgId, provider, mode, credentialsRef, glMappings Json)` — **both confirmed present in the canonical schema** (migration materializes the slice; nothing new).

## `AccountingProvider` interface (`src/lib/integrations/accounting`)
`pushInvoice`, `pushExpense`, `pushPayment`, `reconcile`. Adapters: `zoho` (OAuth), `tally` (connector), **`mock`** (default). All idempotent (idempotency key = our sync-log key), signature/OAuth handled in adapter.

## Domain layer (pure) — `features/accounting-sync/domain/`
- `toAccountingDoc(entity, mappings): Doc` — map our invoice/expense/payment/payroll → provider doc shape.
- `syncKey(provider, entityType, entityId)`.

## Application — consumers & jobs (`features/accounting-sync`)
- Event consumers (00 dispatcher): on `InvoiceIssued`/`PaymentReceived`/`PaymentRefunded`/`ExpenseRecorded`/`PayrollFinalized` → enqueue sync job. **Consumes these settled finance events only — never raw `FolioCharged`** (06 posts many folio lines per stay; syncing them would create double entries — the accounting system journals off issued invoices/received payments/recorded expenses/finalized payroll). (FR-2)
- `syncWorker` (pg-boss): idempotent push; store externalId; sandbox path = log-only. Retry/backoff→dead-letter. (FR-3/4/5)
- `configureAccounting` (`integration:manage`). (FR-7/8)
- Query `reconciliation(provider)`. (FR-6)

## UI — wireframes (admin, tablet/desktop-first)
```
┌───────────────────────────────┐
│ Accounting sync · Zoho (sbx)  │
│ Invoices  42 synced · 1 failed│
│ Expenses  110 synced          │
│ Payroll   Jul ✓               │
│ ⚠ INV/013 failed [retry]      │
│ [Configure ▾ Tally|Zoho|Live] │
└───────────────────────────────┘
```
Reconciliation table + retry + provider/mode config.

## Events
Emits: `AccountingSynced`, `AccountingSyncFailed` (both → admin alert). Consumes: `InvoiceIssued`, `PaymentReceived`, `PaymentRefunded` (06), `ExpenseRecorded` (07), `PayrollFinalized` (21) — **not** raw `FolioCharged`. Catalog: `docs/architecture/domain-events.md`.

## Error catalog
`PROVIDER_ERROR` (→retry/dead-letter), `ALREADY_SYNCED` (idempotent no-op), `FORBIDDEN`, `NOT_CONFIGURED`.

## Edge cases
- Re-delivered event / re-run → idempotent by sync key (FR-3).
- Refund after invoice synced → pushes a credit/adjustment doc.
- Provider outage → retry/dead-letter; finance unaffected.
- Payroll cost synced from 21 (not double from 07).
- Live requires client's accounting account/OAuth — sandbox until then.
