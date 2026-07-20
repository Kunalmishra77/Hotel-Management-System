# /generate-tests

Generate the test suite for a module from its acceptance criteria.

## Steps
1. Read the module's `user-stories.md` (AC-N list) and `design.md`.
2. For each AC, write the test(s) that prove it, named to reference the AC (e.g. `AC-3: rejects overlapping room allocation`).
3. Layer per `rules/testing-strategy.md`:
   - **Unit** — pure domain (folio/GST/availability/occupancy/night-audit) with injected clock + seeded data.
   - **Integration** — server actions vs test DB; RBAC denials; event emission; idempotent webhooks; providers mocked.
   - **E2E** — the module's critical mobile journey (if the spec names one).
4. Cover the money paths, concurrency (no overbooking), authz denials, and edge/error cases explicitly.
5. Ensure deterministic: no real network/clock/random.

Report the AC→test map and any AC that cannot be tested as specified (spec gap).
