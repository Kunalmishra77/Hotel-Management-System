# 15 · Search & Export — Requirements

> Source: client doc §14. Read with `rules/non-functional-requirements.md` (p95<500ms), `rules/compliance.md` (PII gating), `prisma/schema.prisma`. Depth bar: `specs/03-reservations/*`.

## Purpose & scope
Provide **extremely fast** cross-entity search and data export (Excel/PDF/CSV) with PII gating. Federates each owning module's search (guests via 04, reservations via 03, invoices via 06, etc.) into one fast, permissioned surface.

**In scope:** unified search by name, mobile, email, company, GST, booking id, invoice number, date range, booking platform, property; result cards linking to the entity; export of any permitted result set to Excel/PDF/CSV with PII masking + audit.
**Out of scope:** the per-module search internals (each module owns its indexed query — this federates them); AI natural-language search (18 — which compiles NL into the structured query this module runs); report computation (08/14).

## Dependencies
- **Tier 0–3:** 00, and the owning query layers of 03/04/06/07/09; 14 for report exports.
- **Consumed by:** all staff; 18-ai (executes its structured queries here); 08 (export handoff).

## Data owned
None (federation + export layer). **Schema notes:** relies on each module's search indexes (e.g. 04's trigram/token index); the shared `ExportJob` for large async exports is **confirmed present in the canonical schema**.

## Functional requirements (EARS)
- **FR-1 (ubiquitous):** Provide unified search across entities by: name, mobile, email, company, **city**, GST, booking id, invoice number, **ID number** (via `GuestId.valueHash`), **booking source**, date range, booking platform, property — property/org-scoped to the user. (Covers client §14 *and* §4's search facets.)
- **FR-2 (ubiquitous):** Return results **p95 < 500ms** at target volume by delegating to each module's indexed query (no full scans); the multi-entity `search(UnifiedSearchQuery)` fans out across entities and **rank-merges into one normalized stream**, paginated by a **federated cursor** that carries a per-entity continuation token so each shard resumes without re-scanning (`contracts.md`).
- **FR-3 (ubiquitous):** Each result is a typed card (guest/reservation/invoice/expense/staff) linking to the entity, with PII **masked by default** per `compliance.md`/`rbac-matrix.md`.
- **FR-4 (event):** When a user exports a result set, produce Excel/PDF/CSV of the permitted, scoped rows; large exports run as an async `ExportJob` (pg-boss) with a download link.
- **FR-5 (unwanted):** If an export would include PII and the user lacks `export:pii`, then mask/omit those columns; a full-PII export requires `export:pii` and is audited (`export:data`/`export:pii` per matrix).
- **FR-6 (ubiquitous):** Every search and export is authorized server-side and property-scoped; exports are audited (who exported what, when).
- **FR-7 (ubiquitous):** Expose a **structured query interface** — `validateStructuredQuery(StructuredQuery)` — that 18-ai compiles natural language into (never raw SQL); this module validates it against a per-entity field allow-list and executes it with the caller's permissions. This is a **single-entity, typed** path, **distinct from** the multi-entity keyword `search(UnifiedSearchQuery)` of FR-1/2 (both defined in `contracts.md`).

## Non-functional (cited)
Search p95 < 500ms on 100k+ guests / 1M+ folio lines; exports stream (no unbounded memory); async for large sets. (`non-functional-requirements.md`)

## Business rules referenced
`business-rules.md` §20 (authorize/audit), `compliance.md` (PII masking/export gating), `data-model.md` (indexes for hot search paths).
