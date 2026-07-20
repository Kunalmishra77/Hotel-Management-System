# 26 · Data Onboarding / Import — Design

## Schema slice (from canonical `prisma/schema.prisma`)
Owns `ImportBatch`, `ImportRow` + enums `ImportKind`/`ImportBatchStatus`/`ImportRowStatus` (**confirmed present in canonical schema**; migration materializes the slice). Target records are created **only** through 04/03/06 public actions; `ImportRow.targetId/targetType` link each row to its created/merged record for traceability + rollback. Uploaded files live in object storage (`fileObjectKey`), access-controlled + purgeable.

## Domain layer (pure) — `features/data-onboarding/domain/`
- `parseFile(bytes, kind, mapping): RawRow[]` — CSV/Excel → typed rows (streamed for large files).
- `validateRow(raw, kind): {ok; errors[]; normalized}` — required/type/format checks (mobile, email, GSTIN, date, amount-in-paise).
- `dedupPlan(rows, existingLookup): Map<rowNum, action>` — CREATE | MERGE | SKIP (within-file + against existing via 04's dedup keys).
- `importKeyFor(kind, normalized): string` — natural idempotency key (e.g. normalized mobile, external booking id).

## Application — server actions & jobs (`features/data-onboarding`)
Per `api-conventions.md`; all `data:import` (Admin, 🔒).
- `getTemplate(kind)` — headers + example row.
- `createBatch(kind, propertyId?, fileUpload, mapping)` — store file, insert `ImportBatch(DRAFT)` + `ImportRow`s (`raw`). (FR-1/2)
- `validateBatch(batchId)` — dry-run: validate + dedup → set per-row status/action + counts → `VALIDATED`. **No target writes.** Large files → pg-boss job. (FR-3)
- `downloadErrors(batchId)` — CSV of ERROR rows. (FR-7)
- `commitBatch(batchId)` — guard (`VALIDATED`, no un-skipped ERRORs) → per row, in batched transactions, call the owning action, stamp `targetId`, idempotent on `importKey`; emit `ImportCommitted` + audit; `COMMITTED`. (FR-4/5/6)
- `rollbackBatch(batchId)` — discard (uncommitted) or soft-void created targets via `targetId` (committed, within window). (FR-8)

## Commit routing (never a foreign INSERT)
| kind | Owning action called |
|---|---|
| GUESTS | `04.upsertGuest(input, {confirmDuplicate/merge})` |
| RESERVATIONS | historical create → status `CHECKED_OUT`, source from file (else DIRECT), dates from file (→ populates 05 history) |
| BALANCES | `06.postFolioCharge` opening-balance line (or `ensureFolio` + opening line) on the matched guest/reservation |
| ROOMS / STAFF | `02.createRoom`/`01`/`09` create (master-data setup) |

## UI — wireframes (admin, `features/data-onboarding/components/`)
```
┌───────────────────────────────┐
│ Data import · MG Road         │
│ Kind [Guests ▾]  [Template ⭳] │
│ [⤒ Upload CSV/Excel]          │
│ Map columns:                  │
│  Mobile → mobile  Name → …    │
│         [ Validate (dry-run) ]│
│ ── Preview (500 rows) ──      │
│  ✅ 490  ⚠ 6 error  ⟳ 4 dupe  │
│  [Download errors] [Commit]   │
│  [Rollback batch]             │
└───────────────────────────────┘
```
Preview table: row #, status chip (OK/ERROR/DUPLICATE), action (CREATE/MERGE/SKIP), reason. Commit disabled until VALIDATED with no un-skipped errors.

## Events
Emits: `ImportCommitted` (`{batchId, kind, okCount}`), `ImportRolledBack`. Consumes: none. Catalog: `docs/architecture/domain-events.md`.

## Sequences
**Validate (dry-run):** load rows → `validateRow` each → build `dedupPlan` (existing via 04 lookup + in-file) → persist per-row status/action + counts → `VALIDATED`. No writes. **Commit:** guard → for each OK/CREATE|MERGE row: BEGIN → owning-module action (idempotent on `importKey`) → stamp `targetId` → COMMIT (batched) → after all: emit `ImportCommitted` + audit. **Rollback:** committed → for each `targetId` soft-void via the owning module; uncommitted → delete the batch + rows + stored file.

## Error catalog
`COMMIT_NOT_ALLOWED` (not validated / un-skipped errors), `UNKNOWN_MASTER_DATA`, `GUEST_UNMATCHED` (reservation/balance row), `MAPPING_INVALID`, `FILE_PARSE_ERROR`, `FORBIDDEN`.

## Edge cases
- Re-import same file → idempotent no-op (importKey + 04 dedup) (AC-11).
- Within-file duplicates → first CREATE, rest SKIPPED_DUPLICATE (AC-5).
- Reservation/balance row whose guest isn't found → ERROR `GUEST_UNMATCHED` (import guests first), never an orphan (AC-9).
- Referenced room/category/property missing → `UNKNOWN_MASTER_DATA`, never auto-created (AC-13).
- Aadhaar in the file with the flag off → masked last-4 only, no scan (AC-14).
- 10k+ rows → pg-boss job, streamed, progress + completion event (AC-15).
- Partial commit failure → committed rows keep their `targetId`; the batch can resume (idempotent) or be rolled back.
