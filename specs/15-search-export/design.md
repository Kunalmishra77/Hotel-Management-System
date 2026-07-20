# 15 · Search & Export — Design

## Schema slice
None owned. Uses each module's indexes (04 guest trigram/token, 03 reservation, 06 invoice). **Schema notes:** `ExportJob(id, userId, kind, format, filter, status, objectKey, rowCount, includesPii, createdAt)` for async exports is **confirmed present in the canonical schema** (migration materializes the slice; nothing new).

## Two distinct query contracts (both in `contracts.md`)
This module exposes **two separate entry points** — do not conflate them:

**1. `search(query: UnifiedSearchQuery): Result<SearchResult[]>`** — the human, **multi-entity** unified search (FR-1/2/3). Keyword + filters fanned out across several entities at once; results merged into one normalized, cursor-paginated stream.
```ts
type EntityKind = 'guest'|'reservation'|'invoice'|'expense'|'staff';
type UnifiedSearchQuery = {
  keyword?: string;            // matched across name/mobile/email/company/city/GST/booking id/invoice no/ID-hash
  entities?: EntityKind[];     // subset to search; default = all the caller is permitted to see
  filters?: { propertyId?: string; bookingSource?: string; dateRange?: {field; from; to} };
  cursor?: FederatedCursor;    // opaque; encodes a per-entity continuation token
  limit?: number;
};
type FederatedCursor = Partial<Record<EntityKind, string | null>>; // null = that shard is exhausted
type SearchResult = { entity: EntityKind; id: string; title: string; subtitle?; score: number; /* masked fields */ };
```
**Federated cursor pagination / merge:** each requested entity is queried through its **owning module's indexed query layer** with its own continuation token; the page fans out in parallel, each shard returns its top slice, and results are **merged by rank (score, then recency) into a single stream**; the returned `FederatedCursor` packs every entity's next token so the following page resumes each shard where it stopped (no re-scan, no cross-entity join fan-out). A shard whose token is `null` is dropped from subsequent fan-outs. (FR-1/2/3)

**2. `validateStructuredQuery(query: StructuredQuery): Result<StructuredQuery>`** — the **18-ai NL→query** path (FR-7): a **single-entity**, typed query the LLM compiles into, validated against a per-entity field allow-list before execution. Distinct from unified search — one entity, explicit typed filters, **no keyword fan-out**.
```ts
type StructuredQuery = {
  entity: EntityKind;
  filters: Filter[];           // typed, whitelisted fields + operators only
  dateRange?: {field; from; to};
  sort?; cursor?; limit?;
};
```
Validated by zod against the per-entity field allow-list, then executed via the owning module's query layer with the caller's scope. **No raw SQL from callers/LLM** on either path.

## Domain layer (pure) — `features/search/domain/`
- `validateStructuredQuery(q): Result<StructuredQuery>` — field/operator allow-list (the 18-ai path, FR-7).
- `mergeFederated(shards, cursor): {results, nextCursor}` — rank-merge + per-entity cursor packing for unified search (FR-2).
- `toExportRows(results, permissions): Row[]` — PII mask/omit per permission (FR-5).

## Application (`features/search`, `features/exports`)
- `search(query: UnifiedSearchQuery)` — fans out to module query layers per entity; rank-merges; **federated cursor** paginates; masks. (FR-1/2/3)
- `export(query, format)` — permitted+scoped rows → Excel(exceljs)/PDF(react-pdf)/CSV(stream); large → `ExportJob` (pg-boss) + link; audited. (FR-4/5/6)
- Route handlers under `/api/exports/*` for file download.

## UI — wireframes (mobile-first, `features/search/components/`)
```
┌───────────────────────────┐
│ 🔍 search anything        │
│ [Guests][Bookings][Inv]   │
│ ▸ Ravi Kumar (guest)      │
│ ▸ WMG/BK-1042 (booking)   │
│ ▸ WMG/26-27/014 (invoice) │
│ [Export ▾ Excel/PDF/CSV]  │
└───────────────────────────┘
```
Global search bar; typed result cards; export menu (permission-aware).

## Events
Emits: `DataExported` (audited). Consumes: none. Catalog: `docs/architecture/domain-events.md`.

## Error catalog
`INVALID_QUERY`, `FORBIDDEN`, `EXPORT_TOO_LARGE_ASYNC` (→ job), `RATE_LIMITED`.

## Edge cases
- Cross-entity federation → per-entity budget honored; no join fan-out.
- Very large export → async job, streamed, capped, `log()` if truncated.
- LLM-supplied query with a non-whitelisted field → `INVALID_QUERY` (FR-7 guardrail).
- PII export by unauthorized role → masked columns (FR-5).
