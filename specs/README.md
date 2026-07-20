# Specs — structure & quality bar

Each module lives in `specs/NN-<module>/` with **exactly four files**, authored in this order. They form the contract handed to the developer. No feature code exists before a module's `tasks.md` is approved.

## The four files

### 1. `requirements.md`
- **Purpose & scope** (which § of the client doc; in/out).
- **Dependencies** (modules/tiers it needs; see `rules/architecture.md`).
- **Functional requirements** in **EARS** form:
  - Ubiquitous: *The system shall …*
  - Event: *When <trigger>, the system shall …*
  - State: *While <state>, the system shall …*
  - Unwanted: *If <condition>, then the system shall …*
  - Number them `FR-1`, `FR-2`, …
- **Data owned** (tables from `prisma/schema.prisma` this module owns/extends).
- **Non-functional** — cite the relevant budgets from `rules/non-functional-requirements.md`.
- **Business rules referenced** — link the invariants from `rules/business-rules.md` that apply.

### 2. `user-stories.md`
- Stories: *As a <role>, I want <capability>, so that <benefit>.*
- Each story has **acceptance criteria** in Given/When/Then, numbered `AC-1`, `AC-2`, … — concrete and testable (these become tests, `rules/testing-strategy.md`).
- Include negative/permission/edge cases (unauthorized, offline, concurrent, invalid).

### 3. `design.md`
- **Schema slice** — the module's models/fields/indexes/constraints (consistent with the canonical schema).
- **Server actions & queries** — signatures, validation, authorization, transaction boundaries.
- **UI** — screens/components (mobile-first), key states.
- **Events** — emitted and consumed (`docs/architecture/domain-events.md`).
- **Integrations** — adapters used, sandbox/live behavior.
- **Sequences** — step lists/diagrams for the hard flows (e.g. reservation→folio, night audit, split payment, webhook handling).
- **Edge cases & failure handling.**

### 4. `tasks.md`
- Ordered, **small** checkboxed tasks (`- [ ] T-1 …`). Each task:
  - cites the `AC`/`FR` it satisfies,
  - notes tests to write (test-first for domain),
  - ends at `rules/definition-of-done.md`.
- Group by: schema/migration → domain → actions/queries → UI → events → integration → tests.

## Quality bar (self-check before marking a spec ready)
- No `TBD`/placeholder. No requirement interpretable two ways (pick one, state it).
- Every AC is testable; every task traces to an AC/FR; every FR has ≥1 AC.
- Consistent with all steering rules and the canonical schema. Conflicts are raised, not silently resolved.
- Money in paise; time zone-aware; PII handled per `compliance.md`; authz specified per action.
