# /review-module — 15-search-export

**Date:** 2026-08-02 · **Reviewer:** implementing engineer (self-review, per DoD § Review)
**Depends on:** 04 (guest search) · 03 (reservation search) · 06 (invoice search) · 07 (expense search) · 09 (staff search) · 00 (auth/scope/audit/events/storage)
**Tier 3.** Federation + export layer — owns **no tables** (uses `ExportJob`, already in the canonical schema).

Checklist source: [`.claude/commands/review-module.md`](../../.claude/commands/review-module.md)

---

## 1. Traceability — AC → test

**19 domain unit** + **11 integration** + **2 e2e** (×2 projects = 4 runs).

| AC | Requirement | Covered by |
|---|---|---|
| AC-1 | Unified search by mobile / name / company / **city** / GSTIN / booking id / invoice no / **ID number** / source | `search` integration (mobile, company, city) · federate unit · e2e (mobile) · 04 `searchGuests` extended (city + `GuestId.valueHash`) |
| AC-2 | Date-range + booking-platform → reservations only | 03 `searchReservations` (source + checkInDate range) |
| AC-3 | PII masked by default; reveal needs permission | `search` integration (masked mobile) · RBAC (HK gets no guest results) |
| AC-4 | Export Excel/CSV/PDF of permitted scoped rows; large → async job | `export` integration (DONE job + file) · e2e (Excel download) |
| AC-5 | No `export:pii` → columns masked/omitted; with it → full + audited | `export` integration (CSV header omits `mobile`; with pii → raw present + audit row) · `toExportRows` unit |
| AC-6 | 18-ai structured query validated, scoped, masked, no raw SQL | `runStructuredQuery` integration · `validateStructuredQuery` unit |
| AC-7 | Every search/export authorized + property-scoped; exports audited | `export` integration (HK denied FORBIDDEN; audit row) · per-entity RBAC |
| AC-8 | No matches → empty 200, not an error | `search` integration (empty result) |
| AC-9 | Cursor paging stable + non-duplicated (federated tokens) | `mergeFederated` unit (page-2 no repeat; hold-back) |
| AC-10 | Over-threshold export → async `ExportJob`, access-controlled, PII only with `export:pii` | `export` integration (threshold 0 → QUEUED) · download route ownership check |
| AC-11 | Non-whitelisted field / raw SQL → `INVALID_QUERY`, never executed | `validateStructuredQuery` unit · `runStructuredQuery` integration |
| AC-12 | `' ; -- %` treated literally (parameterized), no injection | `search` integration (special chars run safely) |

---

## 2. Invariants

| Invariant | Status |
|---|---|
| Federates owning modules, no foreign SELECTs | ✅ shards call `searchGuests`/`searchReservations`/`searchInvoices`/`searchExpenses`/`searchStaff` only |
| Masked by default | ✅ every result field masked; raw only in an `export:pii` export |
| No raw SQL from callers/LLM | ✅ structured path validated against allow-list then parameterised Prisma |
| Authorized + scoped | ✅ per-entity permission gate on search; `export:data` on export; `db.scoped`/org filter throughout |
| Exports audited + evented | ✅ `DataExported` + audit row on every export (DONE and QUEUED) |
| Money/ids never leak in cursor | ✅ cursor is base64 of per-entity row-ids only |
| No unbounded result set | ✅ per-page cap; export hard cap + async over threshold |

---

## Decisions

### D-1 · Federated cursor = per-entity continuation, advanced only on emitted rows
`mergeFederated` rank-merges shard slices and packs a next token per entity; a shard's token
advances **only past rows actually emitted** this page, so nothing is skipped or repeated across
pages (AC-9) without any cross-entity join or re-scan.

### D-2 · Two query contracts kept distinct (design.md §)
`search(UnifiedSearchQuery)` (multi-entity keyword) and `runStructuredQuery(StructuredQuery)`
(single-entity, typed, 18-ai) are separate entry points. The structured path validates against a
per-entity field/operator allow-list **before** building any Prisma query.

### D-3 · Export PII gate is a pure function; raw enriched only when permitted
`toExportRows(rows, canPii)` omits PII columns unless `export:pii` is held; raw contact is fetched
(decrypted) **only** for a permitted export. CSV header inspection in the integration test proves
the omission end-to-end.

---

## Findings

### F-1 · Non-blocking · guest/staff results have no recency key
`GuestListItem`/`StaffListItem` carry no date, so those shards rank by score + id (recency neutral,
`epoch 0`). Cross-entity ties at equal score favour dated entities. Acceptable — score dominates;
a `createdAt` on the guest list item would refine it.

### F-2 · Non-blocking · expense/staff shards keyword-only
Reservation/invoice score exact key hits to 1.0; expense/staff use a flat 0.5 keyword match. Fine
for their volume; a fielded score could be added.

---

## Carried risks

- **R-1..R-17** from earlier modules — unchanged.
- **R-18 (new) — p95<500ms at 100k not yet measured (T-2/T-5, AC-1).** The search delegates to each
  module's **indexed** query (guest trigram/hash, reservation `code`/`checkInDate`, invoice
  `[propertyId,number]`), so the query *shape* meets the budget by construction, but the **100k+
  seed + timed run is deferred to staging** (same posture as R-1 latency / 04 R-? scale). No full
  scans exist in any shard.
- **R-19 (new) — RBAC divergence reconciled to the matrix (AC-4/5 fixtures).** The spec fixtures put
  `export:data` on Reception; the authoritative `rbac-matrix.md` grants export only to
  ADMIN/MANAGER/ACCOUNTS. Followed the **matrix** (as with 04 AC-9): Reception can search (masked)
  but **cannot export** — the e2e asserts the export menu is hidden for Reception. The masked-export
  (`canPii=false`) path is exercised via a claims object holding `export:data` without `export:pii`.
- **R-20 (new) — async ExportJob is created QUEUED but not yet processed by a worker.** The row +
  audit + event are written and the download route is access-controlled; the pg-boss worker that
  renders a large QUEUED job to storage is a follow-up (the inline path fully renders CSV/Excel/PDF).
- **R-21 (new) — structured-query supports column filters, not derived aggregates.** AC-6's
  "stayed >2× in 2 years" resolves to column filters (city + `createdAt` range); a visit-count
  predicate over `GuestStatsSnapshot` is a follow-up.
