# 15 · Search & Export — User Stories & Acceptance Criteria

Roles per `rules/user-roles.md`; PII gating per `rbac-matrix.md`.

## Test Fixtures
| Ref | Value |
|---|---|
| DATA | 100k guests, 50k reservations, 40k invoices seeded across PROP-A/B |
| U-REC | RECEPTION @ PROP-A (`export:data`, no `export:pii`) |
| U-ACC | ACCOUNTS (`export:data` + `export:pii`) |
| U-MGR | MANAGER @ PROP-A |

## US-1 — Unified fast search
- **AC-1:** Given DATA, when U-REC searches "9800000001", "Ravi", "ACME", a **city**, a GSTIN, a booking id, an invoice number, an **ID number**, or filters by **booking source**, then matching typed result cards return, property-scoped, **p95 < 500ms**, paginated. (FR-1/2 — covers §14 + §4 facets)
- **AC-2:** Given a date-range + booking-platform filter, when searched, then only matching reservations in scope return. (FR-1)
- **AC-3:** Given U-REC (no `export:pii`), when results render, then PII is masked; U-MGR with view-pii + reason can reveal. (FR-3)

## US-2 — Export
- **AC-4:** Given a result set, when U-REC exports to Excel/CSV/PDF, then a file of the permitted, scoped rows is produced; a large set runs as an async `ExportJob` with a download link. (FR-4)
- **AC-5:** Given U-REC (no `export:pii`), when exporting, then PII columns are masked/omitted; U-ACC (`export:pii`) gets full data and the export is audited. (FR-5/6)

## US-3 — Structured query (for 18-ai)
- **AC-6:** Given 18-ai compiles "guests from Bangalore who stayed >2× in 2 years" into a structured query, when this module executes it, then it validates the query, runs it with the caller's permissions/scope (never raw SQL), and returns masked results. (FR-7)

## US-4 — Edge, scale & injection-safety
- **AC-8:** Given a search with **no matches**, then an empty result with a clear "no results" state (HTTP 200, not an error), still within the p95 budget. (FR-1/2)
- **AC-9:** Given a multi-entity search over DATA, when paging with the cursor, then results are **stable and non-duplicated** across pages (federated per-entity continuation tokens + rank-merge, no full re-scan). (FR-2)
- **AC-10:** Given a >N-row export by U-ACC (`export:pii`), then it runs as an async `ExportJob`, the file is access-controlled + the export audited, and full PII appears **only** because `export:pii` is held; the identical export by U-REC omits PII columns. (FR-4/5)
- **AC-11:** Given 18-ai emits a structured query referencing a **non-whitelisted field** (or attempts raw SQL), when validated, then rejected `INVALID_QUERY` and **never executed**. (FR-7)
- **AC-12:** Given a search term containing SQL/regex special characters (`' ; -- %`), when searched, then it is treated as a **literal** (parameterized) — correct results, no injection, no error. (FR-1)

## Security
- **AC-7:** Given any search/export, then it is authorized + property-scoped; every export is audited. (FR-6)
