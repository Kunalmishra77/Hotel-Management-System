# Testing Strategy

Test-first for domain logic. A `tasks.md` item isn't done without the tests its spec's acceptance criteria imply.

## Pyramid
1. **Unit (Vitest) — the largest layer.** Pure domain: folio math, GST split, availability overlap, nights, occupancy/ADR/RevPAR, night-audit rollover, permission checks. Fast, deterministic, no I/O.
2. **Integration (Vitest + test DB).** Server actions end-to-end against Postgres: reservation→folio→invoice, expense approval, RBAC enforcement, event emission, idempotent webhook handling. Providers run in mock/sandbox.
3. **E2E (Playwright).** Critical user journeys on mobile viewport: login, create reservation, check-in, add charges, take split payment, generate GST invoice, housekeeping status update offline→sync.

## What must have tests (non-negotiable)
- Every money path (charges, discounts, tax, payments, refunds, rounding).
- Availability / no-overbooking under concurrent booking.
- RBAC: each sensitive action denied for unauthorized roles.
- GST invoice correctness (intra vs inter-state, numbering gap-free).
- Night audit: idempotent, correct rollover, closed-day immutability.
- Integration adapters: contract tests against the mock + recorded provider fixtures.

## Rules
- Deterministic: no real network, clock injected, seeded data. Providers mocked via the interfaces in `lib/*`.
- Coverage gate: domain layer ≥ 90% lines/branches; overall meaningful coverage on actions. Coverage is a floor, not the goal — assert behavior, not lines.
- Each spec's `user-stories.md` acceptance criteria map to named tests (traceability).
