# CLAUDE.md — Woodpecker PMS

You are working on a **spec-driven** Property Management System. This file is the entry point. Read it fully before any task.

## The Prime Directive

**No code is written before its `tasks.md` exists and is approved.** The pipeline is always:
`scope → steering rules → module spec (requirements → user-stories → design → tasks) → implementation → tests → review`.
If a task is not traceable to a spec, stop and write/upgrade the spec first.

## How to load context (token discipline)

Do **not** read the whole repo. Load only:

1. **Always:** this file + the relevant `.claude/rules/*.md` for the concern you touch.
2. **For a module:** that module's `specs/NN-*/` bundle + the slice of `prisma/schema.prisma` it owns.
3. **For entities/relations:** `prisma/schema.prisma` is the single source of truth — never re-derive a model from prose.

Steering rules are small and always-true. Specs are large and loaded on demand. This is deliberate: it keeps every task's context small.

## Rules index (`.claude/rules/`)

| Rule | Governs |
|---|---|
| `product.md` | Who this is for, the outcomes, the client |
| `scope.md` | The 27 modules; what is in / out |
| `architecture.md` | Layers, module boundaries, dependency graph, folder map |
| `tech-stack.md` | Approved libraries and versions; what not to add |
| `data-model.md` | How to model data; Prisma conventions; money & time rules |
| `business-rules.md` | Domain invariants (availability, folio, GST, night audit) |
| `user-roles.md` | The 6 roles and what each can do |
| `security.md` | AuthN/Z, audit, encryption, backup |
| `compliance.md` | India: DPDP Act, Aadhaar/PII handling, GST |
| `integrations.md` | Provider abstraction; sandbox↔live gating |
| `ai-features.md` | Provider-agnostic LLM layer; guardrails |
| `communications` → see `integrations.md` + spec 12 | WhatsApp/Email/SMS |
| `reporting.md` | Metric definitions (occupancy, ARR, RevPAR, profit) |
| `mobile-first.md` | PWA, offline, responsive, touch |
| `api-conventions.md` | Server actions/route handlers, validation, errors |
| `coding-standards.md` | TS style, naming, file size, imports |
| `testing-strategy.md` | Test pyramid, what to test, coverage gates |
| `non-functional-requirements.md` | Performance/latency/reliability budgets |
| `definition-of-done.md` | The checklist every task must pass |
| `glossary.md` | Ubiquitous language — the exact term for each concept |

## Non-negotiables (violating any of these is a bug)

1. **Money** is never a JS `number`. Integer **paise** in the DB (**`BigInt` for accumulating totals**, `Int` for small bounded values) + `Decimal.js` in logic. See `data-model.md`.
2. **Time**: store UTC; the business day / night-audit boundary is property-local. See `business-rules.md`.
3. **Multi-property tenancy**: every operational row carries `propertyId`; every query is property-scoped. See `architecture.md`.
4. **Availability** is enforced in a transaction — overbooking is impossible by construction. See `business-rules.md`.
5. **RBAC** is checked server-side on every mutation, never only in the UI. See `security.md`.
6. **PII** (Aadhaar, passport, etc.) is encrypted at rest and access-logged. Aadhaar is masked by default behind a config flag. See `compliance.md`.
7. **Integrations** degrade to sandbox/mock when live credentials are absent — the app must run end-to-end with zero external accounts.
8. **Every mutation emits a domain event** and an audit record. Comms/AI/analytics consume events; they never poll tables. See `architecture.md`.

## Commands (`.claude/commands/`)

`/create-spec` · `/implement-module` · `/review-module` · `/generate-tests` — the repeatable workflows. Use them; don't improvise the process.

## Definition of Done

A task is done only when it passes `.claude/rules/definition-of-done.md`. "It compiles" is not done.
