# 15 · Search & Export — Tasks

Federation + export. p95<500ms is the crux. Each ends at `rules/definition-of-done.md`. `(AC-n)/(FR-n)`.

## Schema & migration
- [ ] T-1 Confirm `ExportJob` (**confirmed present in canonical schema**; migration materializes the slice); ensure module search indexes exist (04 trigram/token, 03, 06).
- [ ] T-2 Seed 100k+ dataset for budget tests.

## Domain (tests first)
- [ ] T-3 `validateStructuredQuery` field/operator allow-list on the 18-ai `StructuredQuery` path (rejects non-whitelisted). (FR-7, AC-6)
- [ ] T-3b `mergeFederated` rank-merge + per-entity `FederatedCursor` packing (resume each shard, no re-scan). (FR-2)
- [ ] T-4 `toExportRows` PII mask/omit by permission. (FR-5, AC-5)

## Application (integration + budget tests)
- [ ] T-5 `search(UnifiedSearchQuery)` fans out across entities + rank-merges + **federated-cursor** paginates + masks; p95<500ms on seeded data. (FR-1/2/3, AC-1/2/3)
- [ ] T-6 `export` Excel/PDF/CSV permitted+scoped; async `ExportJob` for large; audit. (FR-4/5/6, AC-4/5/7)
- [ ] T-7 `validateStructuredQuery` + execution for 18-ai's compiled single-entity `StructuredQuery` (no raw SQL, scoped) — distinct from unified search. (FR-7, AC-6)
- [ ] T-8 RBAC/PII gating on search + export. (FR-3/5/6, AC-3/5)

## UI (mobile-first)
- [ ] T-9 Global search bar + typed result cards. (AC-1)
- [ ] T-10 Export menu (permission-aware) + async download. (AC-4)

## E2E
- [ ] T-11 Journey: search by mobile → open guest → export result to Excel (masked for reception). (AC-1/4/5)

## Done
- [ ] T-12 `/review-module` clean; p95 budget met; every AC → green test; DoD satisfied.
