# /implement-module

Implement a module strictly from its approved `tasks.md`.

## Preconditions
- The module's `specs/NN-*/` bundle exists and is approved.
- All modules it depends on (per `rules/architecture.md` tiers) are implemented.

## Steps
1. Load: `CLAUDE.md`, the module spec bundle, the relevant rules, the owned schema slice. Nothing else.
2. Work task-by-task in `tasks.md` order. For each task:
   - Write/adjust the Prisma slice + migration if needed.
   - **Test-first** for domain logic (`rules/testing-strategy.md`).
   - Implement domain → application (server action) → UI, respecting layer rules.
   - Enforce non-negotiables: money in paise, authz server-side, event + audit on mutation, PII rules.
   - Check the box only when the task meets `rules/definition-of-done.md`.
3. Run `typecheck`, `lint`, `test`; add the e2e journey if the spec lists one.
4. Stop at module boundary; do not reach into other modules' internals.

Never implement beyond the current `tasks.md`. New scope → `/create-spec` first.
