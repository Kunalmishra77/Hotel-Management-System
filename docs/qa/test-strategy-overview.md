# QA & Test Strategy Overview

Full rule: [`.claude/rules/testing-strategy.md`](../../.claude/rules/testing-strategy.md). This is the map. **No implementation exists yet** — this documents how the code *will* be verified when built.

## Test pyramid
1. **Unit (Vitest)** — the largest layer. Pure domain: folio/GST math, availability overlap, nights, occupancy/ADR/RevPAR, night-audit rollover, payroll computation, permission checks. Deterministic, injected clock, no I/O.
2. **Integration (Vitest + test Postgres)** — server actions end-to-end: reservation→folio→invoice, RBAC denials, event emission, idempotent webhooks. Providers in mock/sandbox.
3. **E2E (Playwright, mobile viewport)** — critical journeys: login, book, check-in, split payment, GST invoice, housekeeping offline→sync.

## Traceability (the backbone)
Every module's `user-stories.md` numbers its acceptance criteria (`AC-n`). Every `tasks.md` cites the `AC/FR` each task satisfies. `/generate-tests` produces the **AC→test map**. A module is done only when **every AC maps to a green test**.

## Mandatory coverage (non-negotiable)
- Every money path (charges, discounts, tax split, payments, refunds, rounding).
- No overbooking under concurrency (03/13/23).
- RBAC: each sensitive action denied for unauthorized roles.
- GST invoice correctness (intra vs inter-state; gap-free numbering; rollback consumes no number).
- Night audit idempotency + closed-day immutability.
- Integration adapters: contract tests vs mock + recorded fixtures.
- Reconciliation: reports = dashboard = folios, to the paisa.

## Gates
- Domain coverage ≥ 90%; meaningful action coverage. Coverage is a floor, not the goal — assert behavior.
- `typecheck` + `lint` + `test` green; Husky pre-commit enforces typecheck + lint + related tests.
- NFR budgets (search p95 < 500ms, invoice render < 3s) verified via seeded large datasets + timed tests.

## Definition of Done
Every task passes the full checklist in [`.claude/rules/definition-of-done.md`](../../.claude/rules/definition-of-done.md) before its box is checked.
