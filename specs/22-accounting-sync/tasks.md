# 22 · Accounting Sync — Tasks

Event-driven, idempotent, sandbox-by-default. Each ends at `rules/definition-of-done.md`. `(AC-n)/(FR-n)`.

## Schema & migration
- [ ] T-1 Confirm `AccountingSyncLog` + `AccountingConfig` (**both confirmed present in canonical schema**; migration materializes the slice); unique `(provider,entityType,entityId)`.
- [ ] T-2 Seed fixtures (PROV sandbox, INV-1/EXP-1/PAY-1).

## Interface & adapters
- [ ] T-3 `AccountingProvider` interface + `mock` (default) + `zoho`/`tally` adapters; contract tests. (FR-1)
- [ ] T-4 `toAccountingDoc` mapping + `syncKey`. (FR-2/3)

## Application / workers (integration tests)
- [ ] T-5 Event consumers enqueue sync on `InvoiceIssued`/`PaymentReceived`/`PaymentRefunded` (06), `ExpenseRecorded` (07), `PayrollFinalized` (21) — **assert raw `FolioCharged` is NOT consumed** (no double entries). (FR-2, AC-5/6)
- [ ] T-6 `syncWorker` idempotent push + externalId store; sandbox log-only. (FR-3/4, AC-1/2/3)
- [ ] T-7 Retry/backoff → dead-letter + alert; ops unaffected. (FR-5, AC-4)
- [ ] T-8 `configureAccounting` provider/mode switch (config not code) + RBAC. (FR-7/8, AC-8)
- [ ] T-9 `reconciliation` view. (FR-6, AC-7)

## UI (admin)
- [ ] T-10 Reconciliation table + retry + config. (AC-7/8)

## E2E
- [ ] T-11 Journey (sandbox): issue invoice (06) → sync logged → re-deliver → no duplicate. (AC-1/3)

## Done
- [ ] T-12 `/review-module` clean; every AC → green test; DoD satisfied.
