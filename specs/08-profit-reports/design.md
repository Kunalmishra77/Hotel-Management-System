# 08 · Profit Reports — Design

## Schema slice
No owned tables. Reads `DailyStatSnapshot` (14, `expensePaise` = 07-only) + revenue queries (06) + expense rollups (07) + finalized staff cost from **21 `getFinalizedStaffCost(propertyIds, range)`** + segment names (25). **Schema notes:** none required; if monthly reports get heavy at scale, a `MonthlyProfitSnapshot` materialization keyed `(propertyId, month)` is an optional future optimization.

## Domain layer (pure) — reuses 14's `features/analytics/domain`
- `profit(revenuePaise, expensePaise): paise` — the same function 14 exposes (FR-1).
- `apportionStaffCost(monthlyNetPaise, daysInMonth, rangeDays): paise` — evenly spreads a month's finalized payroll net across its days for daily/partial-range views (`monthlyNet ÷ daysInMonth × rangeDays`, paise) (FR-6).
- `incomeVsExpense(revenueByCategory, expenseByHead, staffCost): Breakdown` — staffCost is the apportioned 21 term, added once; expenseByHead never includes it (FR-3/6).
- No new divergent metric math — imports 14's library.

## Application — queries (`features/reports/queries.ts`)
Per `api-conventions.md`; `report:view-financial` required.
- `profitReport(propertyIds, range, grain)` — closed dates from snapshots (`expensePaise` 07-only), open from live 07 figures; adds **21 staff cost via `getFinalizedStaffCost(propertyIds, range)`**, apportioned per `apportionStaffCost` for daily/partial ranges, exactly once. (FR-1/2/6/8)
- `incomeVsExpense(propertyIds, range)` — category/head breakdown + 14 metrics. (FR-3/4)
- `revenueSegments(propertyIds, range)` — by source/corporate/agent. (FR-5)

## UI — wireframes (mobile-first, `features/reports/components/`)
```
┌───────────────────────────┐
│ Profit · Jul 2026 · MG Rd │
│ Revenue        ₹6,80,000  │
│  Room 6.0L · F&B 0.8L     │
│ Expenses       ₹3,60,000  │
│  Ops 2.1L · Staff 1.5L    │
│ ── Profit ─── ₹3,20,000 ──│
│ Occ 66% · ADR ₹4,000      │
│ [By source][By corporate] │
│ [Export ▾]  (→ 15)        │
└───────────────────────────┘
```
Grain toggle (day/month), property selector (scoped), export handoff to 15.

## Events
Emits none (read-only). Consumes snapshots/events indirectly via 14. Catalog: `docs/architecture/domain-events.md`.

## Error catalog
`FORBIDDEN`, `OUT_OF_SCOPE`.

## Edge cases
- Mixed open/closed consolidation → open live + closed snapshot; staff cost added on top of both (FR-2/6).
- Staff cost once (FR-6) — sourced from 21 `getFinalizedStaffCost`, never from `DailyStatSnapshot.expensePaise` (07-only) nor a 07 STAFF-head entry.
- Daily/partial-range view → month's payroll net apportioned evenly (`apportionStaffCost`); a full month sums back to the finalized net (no drift) (FR-6).
- Must equal the live dashboard to the paisa (FR-1) — a reconciliation test guards this.
