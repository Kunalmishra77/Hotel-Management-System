# 26 · Data Onboarding / Import — User Stories & Acceptance Criteria

Roles per `rules/user-roles.md`. Import is Admin-only (`data:import`, 🔒). PII per `compliance.md`.

## Test Fixtures
| Ref | Entity | Value |
|---|---|---|
| ORG / PROP-A | tenancy | "Woodpecker Group" / "Woodpecker MG Road" (exists before import) |
| U-ADMIN | User | ADMINISTRATOR (`data:import`) |
| U-MGR | User | MANAGER (no `data:import`) |
| FILE-G | Guests CSV | 500 rows; 490 valid, 6 missing-mobile (ERROR), 4 duplicate mobiles of existing guests |
| FILE-G-DUP | re-upload | the same FILE-G run twice (idempotency test) |
| FILE-R | Reservations CSV | 300 historical stays (checked-out), each referencing a guest by mobile |
| FILE-B | Balances CSV | 40 opening outstanding balances (guest mobile + ₹ amount) |
| FILE-BADPROP | rows referencing a room/category not in PROP-A |
| CLOCK | injected clock | deterministic import timestamps |

## US-1 — Prepare & upload
*As an Administrator, I want a template and to upload my existing data, so that go-live starts from real data.*
- **AC-1:** Given U-ADMIN chooses kind `GUESTS`, when they request the template, then a CSV with the expected headers + one example row downloads. (FR-2)
- **AC-2:** Given FILE-G (CSV or Excel), when uploaded and columns mapped to fields, then an `ImportBatch(DRAFT)` is created with `rowCount=500`, the file stored in object storage, and the mapping saved. (FR-1/2)
- **AC-3:** Given U-MGR (no `data:import`), when they attempt any import action, then `FORBIDDEN` (403). (FR-11)

## US-2 — Dry-run validation (no writes)
*As an Administrator, I want to preview problems before committing, so that I don't corrupt the live database.*
- **AC-4:** Given the DRAFT batch, when `validateBatch` runs, then each row is classified — 490 OK, **6 ERROR** (missing mobile, with row numbers + reasons), **4 SKIPPED_DUPLICATE** (match an existing guest on mobile) — the batch → `VALIDATED` with those counts, and **no `Guest` records are created**. (FR-3)
- **AC-5:** Given two rows in FILE-G share the same mobile, when validated, then the within-file duplicate is flagged (one CREATE, one SKIPPED_DUPLICATE) — dedup covers both existing and in-file. (FR-3)
- **AC-6:** Given a validated batch, when the admin downloads the **error report**, then it contains exactly the 6 ERROR rows with `rowNum` + reason. (FR-7)

## US-3 — Commit (via owning modules)
*As an Administrator, I want to commit a clean batch, so that guests/bookings/balances exist in the live system.*
- **AC-7:** Given the VALIDATED FILE-G batch (490 OK, 6 ERROR marked SKIP), when `commitBatch` runs, then 490 guests are created **via `04.upsertGuest`** (dedup honored), each `ImportRow.targetId` is set, the batch → `COMMITTED`, and `ImportCommitted` + audit are emitted. (FR-5)
- **AC-8:** Given a DRAFT (never validated) batch, or a VALIDATED batch with ERROR rows not marked SKIP, when commit is attempted, then rejected (`COMMIT_NOT_ALLOWED`); nothing is written. (FR-4)
- **AC-9:** Given FILE-R after guests exist, when committed, then 300 **historical reservations** are created (status `CHECKED_OUT`, dates from the file, guest matched by mobile) so guest history/room-nights populate; a row whose guest can't be matched is ERROR, not a silent orphan. (FR-5)
- **AC-10:** Given FILE-B, when committed, then each opening balance posts an **opening-balance `FolioLine` via 06** (paise, GST-exempt opening line) so the guest's outstanding equals the imported amount and shows in dashboards/reminders. (FR-5)

## US-4 — Idempotency, rollback, master-data guard
- **AC-11:** Given FILE-G already committed, when the **same file** is uploaded and committed again (FILE-G-DUP), then **no duplicate guests** are created (idempotent on `importKey`/mobile + 04 dedup); the second batch reports 0 created / 490 skipped. (FR-6)
- **AC-12:** Given a committed batch, when U-ADMIN rolls it back within the window, then the records it created (via `ImportRow.targetId`) are soft-removed/voided, records it did **not** create are untouched, and the rollback is audited; an uncommitted batch is simply discarded. (FR-8)
- **AC-13:** Given FILE-BADPROP (rows referencing a room/category not in PROP-A), when validated, then those rows are ERROR ("unknown room/category — import master data first"), never auto-creating the referenced master data. (FR-10)

## US-5 — Compliance & scale
- **AC-14:** Given imported guests include Aadhaar values while `COMPLIANCE_STORE_FULL_AADHAAR` is off, when committed, then only masked last-4 is stored, no scan, nothing sensitive logged; the uploaded file is in access-controlled storage and purgeable. (FR-9)
- **AC-15:** Given a 10k-row file, when validate/commit run, then they execute as a **pg-boss job** with progress and a completion event, streamed (bounded memory), never blocking the request. (FR-11, NFR)
