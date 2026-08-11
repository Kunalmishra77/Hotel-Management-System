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

## Running the integration suite (shared-DB caveat)
The integration suite talks to the DB over **`DIRECT_URL`** (session mode) because interactive `$transaction`s need a session-pinned connection (see `tests/setup.ts`). Each test file opens its own `PrismaClient`.
- **Against the shared remote Supabase DB**, running **all ~38 files in one process** (`npx vitest run tests/integration`) intermittently exhausts session connections over the long run → non-deterministic `"Can't reach database server:5432"` / hook timeouts on a *different* random subset each run. This is a **connection-budget artefact, not a product bug** (the failing set changes run-to-run; every suite passes in isolation).
- **Reliable ways to run:** (a) per-suite — `npx vitest run tests/integration/<file>.test.ts` (re-seed first); or (b) a **dedicated `.env.test` Postgres** — `tests/setup.ts` already prefers `.env.test`, giving the suite its own connection budget. See `.env.test.example` for the full recipe (an isolated local cluster on port 5433 works with no Docker and no password: `initdb --auth-host=trust` → `pg_ctl start` → `createdb`).
- **Dedicated-DB run — three switches that matter:** (1) **`SEED_DEMO=false`** on the seed, so the 5-hotel demo enrichment (extra staff, in-house bookings, portfolio snapshots) does NOT pollute the minimal fixture state the tests assert against; (2) **`--no-file-parallelism`**, so files run serially and don't collide on shared rows in the one DB; (3) `STORAGE_BUCKET=` + `NODE_ENV=development` on the seed so it uses local disk and doesn't refuse. With these the **connection-budget flakiness is eliminated** — no more `"Can't reach database server"`, and the suite runs to completion at **~559–560 / 562**.
- **Residual (~2–3 failures) — a SECOND, deeper layer, not fully fixed:** several files (`analytics`, `payroll`, `reports`) derive a "run-unique" far-future month/date from the wall clock (`Math.floor(Date.now()/60_000) % N`, `Date.now() % 2000`). Within one run those windows can OVERLAP, so data cross-contaminates (folio lines, `PayrollRun` keys, room-nights the audit sweeps) — the *exact failing set shifts run-to-run*.
- **Per-file reset harness (built, OPT-IN, default OFF):** `vitest.integration.config.ts` + `tests/integration-reset.ts` truncate+reseed the DB before EACH integration file (triple-gated: only a localhost `woodpecker_test` DB is ever truncated; enable via `RESET_DB_PER_FILE=true`; run `npm run test:integration`). This gives perfect per-file isolation — but running it proved the suite has **hidden cross-file dependencies + ownership assumptions** that only passed because of shared-DB pollution: e.g. `cform`'s `beforeAll` needs a reservation ANOTHER file created (skips 5 tests once isolated); `payroll`'s `afterAll` deleted only its own `PayrollLine`s and FK-broke on the seed staff's lines (FIXED — now deletes by run); `ai` segmentation needs self-sufficient guest data. So the harness is correct but **completing full isolation is a multi-file pass** (make each file self-sufficient), and it triples runtime (per-file reseed). Left off by default until that pass is done; the connection-fix serial run at ~559–560/562 is the current best.
- The unit suite (621 tests, no DB) remains the deterministic gate and always runs clean.
