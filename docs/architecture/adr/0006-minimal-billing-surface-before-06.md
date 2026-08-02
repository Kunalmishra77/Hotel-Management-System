# ADR 0006 — A minimal billing surface before 06-billing exists

**Status:** Accepted · **Date:** 2026-08-01 · **Module:** 03-reservations (Tier 1)

## Context

`business-rules.md` §5 requires that every in-house reservation has exactly one
`Folio`. 03-reservations must therefore create/ensure a folio at two points —
confirming a booking (FR-23) and check-in (FR-9). The design says 03 "calls
`billing.ensureFolio()`".

But **06-billing is a Tier 2 module and is not built yet.** 03 (Tier 1) may only
depend on lower/equal tiers, and — more importantly — `architecture.md` forbids
one module writing another module's tables directly (cross-module access goes
through the target's public surface, `actions.ts`/`queries.ts`). 03 does not own
`Folio`; 06 does.

Two options:
1. Have 03 write the `Folio` row itself. Fast, but bakes a boundary violation
   into the crown-jewel booking transaction — every future 06 change to folio
   creation would have to hunt down this write in 03.
2. Introduce `src/features/billing` now with only the surface 03 needs.

## Decision

Create `src/features/billing/index.ts` exposing a single function, `ensureFolio`,
today. It creates a `Folio` for a reservation if none exists and is idempotent
(the `Folio.reservationId` unique constraint is the backstop). It takes the
caller's transaction client (structural `FolioCapableTx`) so folio creation
commits in the *same* transaction as the reservation state change — no window in
which a confirmed booking has no folio.

06-billing will expand this same file with charges, payments, GST invoices and
night audit. **03's call sites do not change when 06 lands** — that is the whole
point of the surface.

## Consequences

- 03 respects the module boundary from day one; the folio write lives in the
  module that owns `Folio`.
- The surface is deliberately tiny — one function — so it is not a speculative
  06 built early. It grows when 06 is actually implemented.
- `ensureFolio` is unit/integration-tested via 03's create/confirm/check-in
  tests now; 06 will add its own contract tests over the expanded surface.
