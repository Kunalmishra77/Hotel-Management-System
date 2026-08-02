# 08 · Profit Reports — Tasks

Reuses 14's metric library — no divergent math. Each ends at `rules/definition-of-done.md`. `(AC-n)/(FR-n)`.

## Domain (tests first — reuse 14)
- [x] T-1 `profit` + `incomeVsExpense` + **`apportionStaffCost` (monthly net ÷ days-in-month × range-days; full-month reconciles to finalized net)** using 14's library; reconciliation test vs dashboard. (FR-1/3/6, AC-1/2/8/9)

## Application (integration tests)
- [x] T-2 `profitReport` closed=snapshot (`expensePaise` 07-only) / open=live; joins 06/07 + **21 `getFinalizedStaffCost` apportioned per day, added exactly once** (no foreign SELECT into payroll). (FR-1/2/6, AC-1/3/9)
- [x] T-3 `incomeVsExpense` category/head + 14 metrics. (FR-3/4, AC-4)
- [x] T-4 `revenueSegments` by source/corporate/agent. (FR-5, AC-5)
- [x] T-5 Property scoping in consolidation. (FR-8, AC-6)
- [x] T-6 RBAC: `report:view-financial` required. (FR-7, AC-7)

## UI (mobile-first)
- [x] T-7 Profit report (grain toggle, breakdown, metrics). (AC-1/4)
- [x] T-8 Segmentation views + export handoff to 15. (AC-5)

## E2E
- [x] T-9 Journey: open monthly profit → matches dashboard → segment by corporate → export. (AC-1/2/5)

## Done
- [x] T-10 `/review-module` clean; reconciles with 14/06/07/21 to the paisa; every AC → green test; DoD satisfied.
