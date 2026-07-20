# Woodpecker PMS — Documentation Index

This repository is **spec-driven and fully documented**. No feature code is written before an approved `tasks.md`. Read in the order below.

## 1. Start here
- [`/CLAUDE.md`](../CLAUDE.md) — entry point; the prime directive, non-negotiables, and how to load context.
- [`product/product-overview.md`](product/product-overview.md) — what we're building and why.
- [`requirements-traceability.md`](requirements-traceability.md) — **every client §1–19 line → its spec coverage + gaps** (the audit).
- [`architecture/module-connectivity.md`](architecture/module-connectivity.md) — how all 26 modules wire together (calls + events + tiers).

## 2. Steering (always-loaded project law) — [`/.claude/rules/`](../.claude/rules/)
`product` · `scope` · `architecture` · `tech-stack` · `data-model` · `business-rules` · `user-roles` · `security` · `compliance` · `integrations` · `ai-features` · `reporting` · `mobile-first` · `api-conventions` · `coding-standards` · `testing-strategy` · `non-functional-requirements` · `definition-of-done` · `glossary` (19 files).

## 3. Architecture — [`architecture/`](architecture/)
- [`high-level-architecture.md`](architecture/high-level-architecture.md) — C4, layers, request/data flow.
- [`module-connectivity.md`](architecture/module-connectivity.md) — how all 26 modules wire (tiers + calls + events).
- [`contracts.md`](architecture/contracts.md) — **exact cross-module + provider interface signatures**.
- [`rbac-matrix.md`](architecture/rbac-matrix.md) — 37 permissions × 6 roles.
- [`domain-events.md`](architecture/domain-events.md) — the event catalog (internal backbone).
- [`database-setup.md`](architecture/database-setup.md) — extensions, DB-level constraints, migration order.
- [`deployment-and-infra.md`](architecture/deployment-and-infra.md) — hosting, Docker, CI/CD, environments, DR.
- [`observability.md`](architecture/observability.md) — logging, metrics, alerts, health, runbooks.
- [`ui-foundation.md`](architecture/ui-foundation.md) — design system, tokens, shared components, UX patterns.
- [`schema-deltas.md`](architecture/schema-deltas.md) — change history (now **APPLIED**) + open client questions.
- [`adr/`](architecture/adr/) — 5 architecture decision records.
- [`../prisma/schema.prisma`](../prisma/schema.prisma) — **canonical data model (source of truth), finalized (66 models)**.

## 4. Data & entities — [`entities/`](entities/)
- [`erd.md`](entities/erd.md) — ER diagram + entity ownership map + encoded invariants.

## 5. Specs — [`/specs/`](../specs/) (26 modules × 4 files)
Each `specs/NN-*/`: `requirements.md` (EARS) → `user-stories.md` (Given/When/Then ACs + fixtures) → `design.md` (schema slice, wireframes, sequences, error catalog) → `tasks.md` (traced, checkboxed). Structure & quality bar: [`/specs/README.md`](../specs/README.md). Depth exemplar: [`03-reservations`](../specs/03-reservations/).

## 6. Automation & workflows — [`workflows/`](workflows/)
- [`automation-catalog.md`](workflows/automation-catalog.md) — every scheduled job + event-driven automation + the §11 comms automations.
- [`key-workflows.md`](workflows/key-workflows.md) — the critical end-to-end sequences.
- [`development-process.md`](workflows/development-process.md) — the spec-driven build process, commands, and build order.
- [`seed-data.md`](workflows/seed-data.md) — the deterministic demo/seed dataset (+ opt-in scale seed for NFR tests).

## 7. Integrations — [`integrations/`](integrations/)
- [`catalog.md`](integrations/catalog.md) — every external integration, its contract, sandbox/live matrix, and the client's live-activation blockers.

## 8. API surface — [`api/`](api/)
- [`api-surface.md`](api/api-surface.md) — server actions + route handlers + webhooks.

## 9. Reports & QA
- [`reports/report-catalog.md`](reports/report-catalog.md) — all reports + canonical metric definitions.
- [`qa/test-strategy-overview.md`](qa/test-strategy-overview.md) — test pyramid + AC traceability + gates.

## 10. Process tooling — [`/.claude/`](../.claude/)
- [`commands/`](../.claude/commands/) — `/create-spec`, `/implement-module`, `/review-module`, `/generate-tests`.
- [`memory/decisions.md`](../.claude/memory/decisions.md) — decision log.

---
**Status:** documentation complete across steering, specs, architecture, automation, and integrations. **Implementation not started** (by direction). When greenlit, build proceeds in the dependency-tier order in [`development-process.md`](workflows/development-process.md), starting with `00-platform`.
