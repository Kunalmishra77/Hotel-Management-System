# QA & Test Strategy Overview

Full rule: [`.claude/rules/testing-strategy.md`](../../.claude/rules/testing-strategy.md). This is the map. **No implementation exists yet** — this documents how the code *will* be verified when built.

## Test pyramid
1. **Unit (Vitest)** — the largest layer. Pure domain: folio/GST math, availability overlap, nights, occupancy/ADR/RevPAR, night-audit rollover, payroll computation, permission checks. Deterministic, injected clock, no I/O.
2. **Integration (Vitest + test Postgres)** — server actions end-to-end: reservation→folio→invoice, RBAC denials, event emission, idempotent webhooks. Providers in mock/sandbox.
3. **E2E (Playwright, mobile viewport)** — the cross-module **journeys** enumerated in [`journey-acceptance.md`](./journey-acceptance.md) (J1–J8): book→stay→GST invoice→night audit, OTA→folio, web-booking→coupon, night-audit close, payroll→profit, go-live import, housekeeping offline→sync, corporate credit settle.

## Traceability (the backbone)
Every module's `user-stories.md` numbers its acceptance criteria (`AC-n`). Every `tasks.md` cites the `AC/FR` each task satisfies. `/generate-tests` produces the **AC→test map**. A module is done only when **every AC maps to a green test**. Cross-module behavior and NFR budgets that no single module can assert live in [`journey-acceptance.md`](./journey-acceptance.md) — each journey maps to a named E2E test and each NFR row to a timed assert on the scale seed.

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
- NFR budgets (search p95 < 500ms, invoice render < 3s, realtime < 2s, mutation p95 < 800ms) verified via seeded large datasets + timed tests — the [`journey-acceptance.md`](./journey-acceptance.md) NFR table is the authoritative list; a regression blocks merge.
- Green J1–J8 journeys + green NFR asserts are part of the release Definition of Done.

## Definition of Done
Every task passes the full checklist in [`.claude/rules/definition-of-done.md`](../../.claude/rules/definition-of-done.md) before its box is checked.
