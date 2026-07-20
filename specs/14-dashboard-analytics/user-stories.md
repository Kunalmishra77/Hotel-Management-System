# 14 · Dashboard & Analytics — User Stories & Acceptance Criteria

Roles per `rules/user-roles.md`; metric definitions per `rules/reporting.md`.

## Test Fixtures
| Ref | Entity | Value |
|---|---|---|
| PROP-A | Property | tz Asia/Kolkata, 10 sellable rooms |
| PROP-B | Property | tz Asia/Kolkata, 20 sellable rooms |
| DAY | Business date | 12 Jul 2026 (open) |
| STATE-A | PROP-A on DAY | 6 occupied, 1 maintenance, room revenue ₹24,000 |
| U-MGR | User | MANAGER @ PROP-A (`report:view-operational` + `report:view-financial`) |
| U-REC | User | RECEPTION @ PROP-A (`report:view-operational` only) |
| CLOCK | Injected clock | scheduled audit time + concurrency tests |

## US-1 — Canonical metrics (defined once)
- **AC-1:** Given STATE-A (available room-nights = (10−1)=9, occupied = 6, room revenue ₹24,000), when computed, then occupancy = 6/9 = 66.67% (6667 bps), ADR = 24,000/6 = ₹4,000, RevPAR = 24,000/9 = ₹2,667 — using the `reporting.md` definitions (room revenue only, tax-excluded). (FR-1/11)
- **AC-2:** Given the same numbers requested by 08-profit-reports, then it reuses this module's functions and gets identical values (no divergence). (FR-1)

## US-2 — Live dashboard
- **AC-3:** Given DAY open, when U-MGR opens the dashboard, then tiles show today's check-ins (expected vs arrived), check-outs, vacant/occupied/maintenance counts, revenue today, expenses today, pending payments, advance & cancelled bookings — for PROP-A. (FR-2)
- **AC-4:** Given the dashboard open, when a guest checks in (event `GuestCheckedIn`), then the occupied tile and occupancy update within **2s** without refresh. (FR-4)
- **AC-5:** Given U-MGR scoped to PROP-A only, when consolidated view is requested, then only PROP-A is aggregated, not PROP-B. (FR-15)

## US-3 — Permissions
- **AC-6:** Given U-REC (no `report:view-financial`), when opening the dashboard, then financial tiles (revenue, expenses, pending, ADR, RevPAR, top corporates) are excluded **server-side**; operational tiles remain. (FR-14)

## US-4 — Night audit
- **AC-7:** Given PROP-A's scheduled audit time is reached, when the job fires, then a `NightAuditRun` starts for DAY and, in order: posts room-night charges via 06, marks no-shows via 03, persists a `DailyStatSnapshot(PROP-A, DAY)`. (FR-5/6)
- **AC-8:** Given a snapshot for (PROP-A, DAY) exists, when the audit re-runs for DAY, then it is a no-op returning the existing snapshot (idempotent). (FR-7)
- **AC-9:** Given a snapshot is persisted, then the business date rolls to 13 Jul and DAY is locked against back-dated edits (except audited adjustment); `NightAuditCompleted` emitted + audited. (FR-8/9)
- **AC-10:** Given the audit fails during room posting, then the run is `FAILED`, no completion event, business date unchanged, and a re-run is safe (idempotent downstream). (FR-10)
- **AC-11:** Given two audits triggered concurrently for (PROP-A, DAY), when both run, then exactly one proceeds (unique + advisory lock); the other no-ops. (FR-16)
- **AC-12:** Given a checked-out folio with balance due at close, then `PaymentDueDetected` is emitted for 12. (FR-17)

## US-5 — Trends & segments
- **AC-13:** Given closed dates, when trends are viewed, then daily/monthly occupancy + revenue, cancellations, and advance-booking pace read from snapshots (open date reads live). (FR-3/12)
- **AC-14:** Given a date range, when segments are viewed, then top corporate clients, travel agents, and repeat guests are ranked by revenue **and** room-nights. (FR-13)

## Reconciliation / scale
- **AC-15:** Given a closed date, when the same metric is read twice, then it returns the identical immutable snapshot value; money in paise, occupancy in bps internally. (FR-18)
- **AC-16:** Given 10 properties + 2 years of snapshots, when trends load, then within the NFR budget (snapshot O(1) reads + pagination). (NFR)
