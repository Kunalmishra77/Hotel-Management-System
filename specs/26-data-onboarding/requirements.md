# 26 · Data Onboarding / Import — Requirements

> Go-live capability (derived from the Objective: "maintain a **complete** guest database" — no property goes live empty). Read with `.claude/rules/compliance.md` (PII on import), `business-rules.md` (folio/money), `data-model.md`, `prisma/schema.prisma`. Depth bar: `specs/03-reservations/*`.

## Purpose & scope
Let an Administrator import an existing property's data at go-live — **guests, historical bookings, opening outstanding balances** (and optionally master data: room categories/rooms, staff) — from **CSV/Excel**, safely: column mapping, a **dry-run validation** with a per-row preview, **dedup** against existing + within-file records, a downloadable **error report**, **idempotent** re-runnable batches, and **per-batch rollback**. Nothing is written until the admin commits a validated batch.

**In scope:** upload + template download; column→field mapping; dry-run `validateBatch` (parse, type/format/required checks, dedup, per-row OK/ERROR/DUPLICATE + summary — **no writes**); `commitBatch` (create via the owning modules' authorized actions, batched + idempotent + audited); error CSV; rollback; large-file handling via a pg-boss job; PII/compliance on imported personal data.
**Out of scope:** live 2-way OTA sync (13); ongoing ETL/scheduled feeds; editing already-closed financial periods; building the source spreadsheets. This is a one-time (repeatable) go-live/onboarding tool, not an integration.

## Dependencies
- **Tier 0–2:** 00-platform (auth, tenancy, object storage, events, audit, pg-boss), 01/02 (property/rooms must exist first), 04-guest-crm (`upsertGuest` + dedup), 03-reservations (historical reservation create), 06-billing (opening-balance folio line).
- **Consumed by:** none (it feeds the other modules at go-live); 14-analytics sees imported history like any other data.

## Data owned
`ImportBatch`, `ImportRow` (confirmed present in canonical schema) + enums `ImportKind`, `ImportBatchStatus`, `ImportRowStatus`. Creates target records **only** through 04/03/06 public actions — never foreign INSERTs into their tables. `ImportRow.targetId` links each row to the record it created/merged (traceability + rollback).

## Functional requirements (EARS)
- **FR-1 (ubiquitous):** Represent each import as an `ImportBatch` scoped to org (+ optional property), with a `kind` (GUESTS/RESERVATIONS/BALANCES/ROOMS/STAFF), the uploaded source (`fileObjectKey`), a column→field `mapping`, and status DRAFT→VALIDATED→COMMITTED (or FAILED/ROLLED_BACK).
- **FR-2 (ubiquitous):** Provide a downloadable **template** (headers + example row) per `kind`, and accept **CSV or Excel** upload; parse it into `ImportRow`s preserving the original `raw` values.
- **FR-3 (event):** When `validateBatch` (dry-run) runs, the system shall validate every row (required fields, types, formats — mobile/email/GSTIN/date/amount), run **dedup** (against existing records via 04's logic **and** within the file), classify each row OK / ERROR (with reason) / SKIPPED_DUPLICATE, set an `action` (CREATE | MERGE | SKIP), and persist the counts — **writing no target records**. The admin sees a per-row preview + summary before committing.
- **FR-4 (unwanted):** If a batch is committed while still `DRAFT` (never validated) or with `errorCount > 0` on rows the admin has not explicitly chosen to skip, reject — commit requires a `VALIDATED` batch with every remaining row OK or explicitly SKIP.
- **FR-5 (event):** When `commitBatch` runs, the system shall, per row in batched transactions, create the target via the owning module's authorized action — **GUESTS** → `04.upsertGuest` (dedup/merge honored); **RESERVATIONS** → a historical reservation (status `CHECKED_OUT`, its original source or `DIRECT`, dates from the file) so guest history is populated; **BALANCES** → an opening-balance `FolioLine` via 06 on the guest's/reservation's folio — stamp `ImportRow.targetId/targetType`, and emit `ImportCommitted` + audit.
- **FR-6 (ubiquitous):** Imports are **idempotent** — each row carries an `importKey` (e.g. normalized mobile / external booking id); re-running a committed batch, or re-importing the same file, creates **no duplicates** (dedup on `importKey` + the target module's own dedup).
- **FR-7 (event):** When validation or commit finishes, the system shall produce a downloadable **error report** (the ERROR rows with `rowNum` + reason) so the admin can fix just those and re-import.
- **FR-8 (event):** When an admin **rolls back** a batch, the system shall: a batch not yet committed → discard it; a committed batch (within a policy window) → soft-remove/void the records it created (found via `ImportRow.targetId`), preserving audit and never touching records it did not create.
- **FR-9 (ubiquitous):** Imported PII follows `compliance.md` — Aadhaar masked by default (no full value/scan unless the flag permits), contact encrypted, nothing sensitive logged; the imported file itself lives in access-controlled object storage and is purgeable.
- **FR-10 (unwanted):** If the batch targets a property/category/room that does not exist, reject the affected rows with a clear reason (import master data first, or fix the mapping) — never auto-create referenced master data silently.
- **FR-11 (ubiquitous):** Every import action is **Admin-only** (`data:import`, 🔒), property/org-scoped, and audited; large files (10k+ rows) process as a **pg-boss job** with progress + a completion event, never blocking the request.

## Non-functional (cited)
Dry-run validation of a 10k-row file completes within a reasonable bound and streams (no unbounded memory); commit runs in batches with progress; re-import is a no-op (idempotent); PII encrypted + India region. (`non-functional-requirements.md`, `compliance.md`)

## Business rules referenced
`business-rules.md` §5–8 (opening balances post to a folio as money in paise), §16 (guest dedup on phone/email/ID), §17 (history is derived — imported reservations/folios drive it), §20 (validate→authorize→transaction→event→audit). `compliance.md` (Aadhaar/PII on import). `data-model.md` (no foreign INSERTs; create via owning modules).
