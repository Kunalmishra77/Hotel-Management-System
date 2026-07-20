# 08 · Income vs Expense / Profit Reports — Requirements

> Source: client doc §7. Read with `rules/reporting.md` (canonical definitions), `prisma/schema.prisma`. Reuses 14's metric library + snapshots; does not recompute differently. Depth bar: `specs/03-reservations/*`.

## Purpose & scope
Present income-vs-expense and **profit** per day/month/property (and consolidated), plus revenue segmentation (by booking source, corporate client, travel agent). This module is a **reporting/presentation** layer over 06 (revenue), 07 (expenses), 21 (staff cost), and 14 (metric library + `DailyStatSnapshot`).

**In scope:** daily/monthly/property/consolidated profit; income vs expense breakdown; occupancy/ADR/RevPAR surfaced from 14; revenue by source/corporate/agent; export handoff to 15.
**Out of scope:** metric computation (14 owns the library), night audit (14), folio/GST (06), expense entry (07), the live operational dashboard tiles (14).

## Dependencies
- **Tier 0–3:** 00, 01; 14-dashboard-analytics (metric library + snapshots), 06-billing (revenue queries), 07-expenses (expense rollups), 21-payroll (finalized staff cost via `getFinalizedStaffCost`; `PayrollFinalized` for cache invalidation), 25-corporate-crm (segment names).
- **Consumed by:** 15-search-export (export), owners/managers.

## Data owned
None new — reads via other modules' query layers + `DailyStatSnapshot` (confirmed present in canonical schema; its `expensePaise` carries **07 approved expenses only** — staff cost is added by 08 at report time, never stored double). **Schema notes:** none required; if a materialized monthly profit view is needed for scale, a `MonthlyProfitSnapshot` keyed `(propertyId, month)` remains an optional future optimization.

## Functional requirements (EARS)
- **FR-1 (ubiquitous):** Compute **profit = revenue − expenses** per day/month/property using 14's metric library and 06/07/21 figures, where — per the single definition in `reporting.md` — **expenses = Σ 07 approved entries by head (excluding the STAFF head's salary spend) + finalized payroll staff cost from 21**, the staff salary counted **exactly once**; never recompute a metric differently (`business-rules.md` §21). *(FR-1 and FR-6 are one rule: FR-6 supplies the staff-cost term of FR-1's expenses.)*
- **FR-2 (state):** While a business date is closed, read its immutable `DailyStatSnapshot` (whose `expensePaise` is 07-only); for the open date, read live 07 figures. In **both** cases the 21 staff-cost term of FR-6 is added on top at report time (`business-rules.md` §15).
- **FR-3 (ubiquitous):** Present income vs expense with revenue split by category (room/F&B/other, net-of-discount, tax-excluded) and expenses split by head, with the payroll staff cost shown as its own expense line.
- **FR-4 (ubiquitous):** Surface occupancy%, ADR/ARR, RevPAR from 14 alongside financials.
- **FR-5 (ubiquitous):** Provide revenue segmentation: by booking source, by corporate client, by travel agent, over a date range.
- **FR-6 (ubiquitous):** Obtain finalized staff cost from **21 via `getFinalizedStaffCost(propertyIds, range)`** (never a foreign SELECT into payroll tables) and add it to expenses **exactly once** — never also as a 07 STAFF-head salary entry (the STAFF head holds only non-payroll spend). Because payroll is monthly (`PayrollRun` per `(property, month)`), for a **daily or partial-month** profit view the month's finalized net is **apportioned evenly across the month's days** (monthly net ÷ calendar-days-in-month × days-in-range), added on top of `DailyStatSnapshot.expensePaise` so the two never double-count (`reporting.md`).
- **FR-7 (unwanted):** If a user lacks `report:view-financial`, deny access to profit/revenue/expense reports server-side.
- **FR-8 (ubiquitous):** All reads are property-scoped to the user's assignments; consolidated views aggregate only in-scope properties; money in paise, percentages in bps internally.

## Non-functional (cited)
Reports load within budget on 10+ properties / years of history via snapshots + indexes + pagination; consistent with the live dashboard to the paisa. (`non-functional-requirements.md`)

## Business rules referenced
`business-rules.md` §15 (closed = snapshot, open = live), §20–21 (authorize/audit; no divergent recompute); `reporting.md` (every metric definition).
