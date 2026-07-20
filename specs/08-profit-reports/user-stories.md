# 08 · Profit Reports — User Stories & Acceptance Criteria

Roles per `rules/user-roles.md`; metric definitions per `reporting.md`.

## Test Fixtures
| Ref | Entity | Value |
|---|---|---|
| PROP-A | Property | July: room revenue ₹6,00,000; F&B ₹80,000; expenses ₹2,10,000; staff cost (payroll) ₹1,50,000 |
| RANGE | Date range | 1–31 Jul 2026 |
| U-MGR | User | MANAGER (`report:view-financial`) |
| U-HK | User | HOUSEKEEPING (no financial reports) |

## US-1 — Profit
- **AC-1:** Given PROP-A July figures, when the monthly profit report runs, then revenue = ₹6,80,000; **expenses = 07 approved (excl. STAFF salary) ₹2,10,000 + finalized payroll staff cost ₹1,50,000 (via `21.getFinalizedStaffCost`) = ₹3,60,000**; **profit = ₹3,20,000** — using 14's library + 06/07/21. (FR-1/6)
- **AC-2:** Given the same numbers requested on the live dashboard (14) and here, then they match to the paisa (no divergence). (FR-1)
- **AC-3:** Given a closed date, when its profit is read, then expenses use the immutable snapshot's `expensePaise` (07-only) **plus** the apportioned 21 staff cost added at report time; the open date uses live 07 figures plus the same staff-cost term. (FR-2/6)
- **AC-9:** Given the July run finalized at net ₹1,50,000 over a 31-day month, when a **single-day** (or partial-range) profit view is requested, then the staff cost added is apportioned evenly — round(₹1,50,000 ÷ 31) ≈ ₹4,838.71/day (483,871 paise, carried in paise) — added on top of that day's `DailyStatSnapshot.expensePaise` (07-only), and a full-month sum reconciles back to ₹1,50,000. (FR-6)

## US-2 — Breakdown & metrics
- **AC-4:** Given the report, then revenue splits by category (room/F&B/other, net-of-discount, tax-excluded) and expenses by head; occupancy/ADR/RevPAR are shown from 14. (FR-3/4)

## US-3 — Segmentation
- **AC-5:** Given RANGE, when segmentation runs, then revenue by booking source, by corporate client, and by travel agent is returned, ranked. (FR-5)

## US-4 — Scope & permission
- **AC-6:** Given U-MGR scoped to PROP-A, when consolidated profit runs, then only PROP-A is aggregated. (FR-8)
- **AC-7:** Given U-HK (no `report:view-financial`), when opening any profit report, then `FORBIDDEN`. (FR-7)
- **AC-8:** Given staff cost, then it is counted **once** — from `getFinalizedStaffCost`/`PayrollFinalized` (21), never also as a 07 STAFF-head salary expense (the STAFF head holds only non-payroll spend), and never read from payroll tables directly. (FR-6)
