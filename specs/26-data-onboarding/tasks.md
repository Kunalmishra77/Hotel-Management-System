# 26 · Data Onboarding / Import — Tasks

Test-first for parse/validate/dedup. Creates targets only via 04/03/06. Each ends at `rules/definition-of-done.md`. `(AC-n)/(FR-n)`.

## Schema & migration
- [x] T-1 Confirm `ImportBatch`/`ImportRow` + `ImportKind`/`ImportBatchStatus`/`ImportRowStatus` (**present in canonical schema**); migration materializes the slice; indexes `(orgId,status)`, `(batchId,status)`, `(importKey)`, unique `(batchId,rowNum)`.
- [x] T-2 Seed fixtures (ORG/PROP-A, U-ADMIN, FILE-G/R/B sample files).

## Domain (tests first)
- [x] T-3 `parseFile` CSV + Excel → typed rows (streamed). (FR-2)
- [x] T-4 `validateRow` per kind (required/type/format: mobile/email/GSTIN/date/amount). (FR-3, AC-4)
- [x] T-5 `dedupPlan` within-file + against existing (04 keys) → CREATE/MERGE/SKIP. (FR-3, AC-5)
- [x] T-6 `importKeyFor` natural idempotency key. (FR-6, AC-11)

## Application (integration tests)
- [x] T-7 `getTemplate` + `createBatch` (store file, DRAFT + rows). (FR-1/2, AC-1/2)
- [x] T-8 `validateBatch` dry-run: classify + counts + `VALIDATED`, **assert no target writes**. (FR-3, AC-4/5)
- [x] T-9 `downloadErrors` = ERROR rows only. (FR-7, AC-6)
- [x] T-10 `commitBatch` GUESTS → `04.upsertGuest`, targetId stamped, `ImportCommitted` + audit. (FR-5, AC-7)
- [x] T-11 Commit guard: DRAFT / un-skipped ERROR rejected. (FR-4, AC-8)
- [x] T-12 RESERVATIONS commit → historical CHECKED_OUT via 03; unmatched guest → `GUEST_UNMATCHED`. (FR-5, AC-9)
- [x] T-13 BALANCES commit → opening-balance FolioLine via 06; outstanding reconciles. (FR-5, AC-10)
- [x] T-14 Idempotency: re-commit same file → 0 created / all skipped. (FR-6, AC-11)
- [x] T-15 `rollbackBatch`: committed → soft-void via targetId (others untouched); uncommitted → discard. (FR-8, AC-12)
- [x] T-16 Master-data guard → `UNKNOWN_MASTER_DATA`, no auto-create. (FR-10, AC-13)
- [x] T-17 PII/compliance: Aadhaar masked, no scan, nothing sensitive logged; file access-controlled. (FR-9, AC-14)
- [x] T-18 RBAC: non-admin denied. (FR-11, AC-3)
- [x] T-19 Large-file pg-boss job: progress + completion event, streamed. (FR-11, AC-15)

## UI (admin)
- [x] T-20 Upload + column mapping + template download. (AC-1/2)
- [x] T-21 Dry-run preview table (status/action/reason) + error download + commit/rollback. (AC-4/6/7/12)

## E2E
- [x] T-22 Journey: upload guests → validate (see errors/dupes) → fix + re-upload → commit → import bookings → import balances → verify guest history + outstanding; re-import is a no-op. (AC-2/4/7/9/10/11)

## Done
- [x] T-23 `/review-module` clean; every AC → green test; DoD satisfied. No foreign INSERTs — all creates via 04/03/06.
