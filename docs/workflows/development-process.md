# Development Process (spec-driven, automated)

How work flows from idea to done in this repo. This is the process the 27 modules are built through — documented so any developer or agent follows the same path. **No feature code exists before an approved `tasks.md`.**

## The pipeline
```
steering rules (once)  →  module spec (per feature)  →  implementation  →  review  →  done
  .claude/rules/*          specs/NN-*/                   (Tier order)       /review    DoD
                           requirements → user-stories
                                → design → tasks
```

## Reusable commands (`.claude/commands/`)
| Command | Does |
|---|---|
| [`/create-spec`](../../.claude/commands/create-spec.md) | Author/upgrade a module's 4-file bundle against the steering rules + canonical schema |
| [`/implement-module`](../../.claude/commands/implement-module.md) | Build a module strictly from its approved `tasks.md`, test-first, in layer order |
| [`/review-module`](../../.claude/commands/review-module.md) | Verify a module against its spec + rules (traceability, invariants, security, NFRs) |
| [`/generate-tests`](../../.claude/commands/generate-tests.md) | Generate the test suite from a module's acceptance criteria (AC→test map) |

## Build order (dependency tiers — [architecture.md](../../.claude/rules/architecture.md))
```
Tier 0  00-platform · 01-property · 02-room-inventory     ← foundation, build first
Tier 1  04-guest-crm · 03-reservations
Tier 2  06-billing · 05-history · 07-expenses · 09-staff · 10-housekeeping · 11-maintenance
Tier 3  08-profit · 14-analytics · 15-search-export
Tier 4  12-communications · 18-ai
Tier 5  13-ota · 23-booking-engine · 24-dynamic-pricing
Tier 6  19-pos · 20-inventory · 21-payroll · 22-accounting-sync
Tier 7  25-corporate-crm · 26-data-onboarding (go-live import)
```
A module builds only after its dependencies are green. Its **task T-1** materializes that module's slice of the **already-finalized** [`prisma/schema.prisma`](../../prisma/schema.prisma) via a migration (all [schema deltas](../architecture/schema-deltas.md) are folded in; T-1 also adds the DB-level constraints in [database-setup.md](../architecture/database-setup.md)).

## Per-module loop (when implementation begins)
1. Load only: `CLAUDE.md` + relevant `.claude/rules/*` + this module's spec + its schema slice (token discipline).
2. Materialize the module's schema slice + migration + DB constraints (T-1) — the deltas are already in the canonical schema.
3. **Test-first**: write the failing test for a `tasks.md` item (mapped to its AC/FR) → watch it fail → minimal code → green → refactor.
4. Enforce non-negotiables every task: money in paise, server-side authz, event+audit on mutations, PII rules, integrations sandbox-by-default.
5. Check a `tasks.md` box only when it passes the [Definition of Done](../../.claude/rules/definition-of-done.md).
6. `/review-module` before the module is considered complete.

## Quality gates
- Every acceptance criterion maps to a named test (traceability).
- `typecheck` + `lint` + `test` green; domain coverage ≥ 90%; critical e2e journeys pass.
- Husky pre-commit runs typecheck + lint + related tests.

## Current status
**Documentation phase complete. No implementation started** (per direction). All steering, specs, architecture, automation, and integration docs are authored and ready for the developer to execute when the client greenlights implementation.
