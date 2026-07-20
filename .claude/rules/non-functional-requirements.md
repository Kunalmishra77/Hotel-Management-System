# Non-Functional Requirements (NFRs)

The client stated several performance expectations as prose. Here they are as **testable budgets**. Specs must reference the relevant ones as acceptance criteria.

## Performance (mobile mid-range device, 4G)
- **Invoice generation < 60s of staff time** (§5) — target: the invoice action completes and PDF renders in **< 3s**; the *flow* (open guest → generate → present) achievable in under a minute.
- **Search "extremely fast" (§14)** — p95 result for indexed multi-field search **< 500ms** at expected data volumes.
- First meaningful interaction on the reservation/check-in screen **< 2.5s** (cold), **< 1s** (warm).
- Common mutations (status change, add charge, take payment) feel instant via optimistic UI; server confirm p95 **< 800ms**.
- Live occupancy/dashboard update latency (event→screen) **< 2s**.

## Scale (design targets)
- 10+ properties, 1,000+ rooms total, 100k+ guests, 1M+ folio lines, years of history — search and reports stay within budget via proper indexing + pagination + snapshotting.
- Concurrent staff: dozens per property without lock contention on availability (short transactions, correct indexes).

## Reliability & availability
- No overbooking under concurrency (correctness > availability on the booking path).
- Daily backup success ≥ 99%; documented restore procedure with periodic drill.
- Integration failures degrade gracefully (retry/backoff/dead-letter), never block the front desk.

## Usability
- Learnable by non-technical staff with minimal training (§Objective). Critical flows ≤ a few taps.
- Full function on phone/tablet/laptop; offline for housekeeping status.

## Security/compliance (see `security.md`, `compliance.md`)
- PII encrypted at rest + in transit; audit on every business mutation; India data region.

## Observability
- Structured logs with request id; error rate + latency dashboards; alerts on job failures, webhook signature failures, backup failure.

## How NFRs are verified
- Load/search budgets: seeded large dataset + timed integration tests. Journeys: Playwright on mobile viewport. Budgets are CI-checked where feasible; regressions block merge.
