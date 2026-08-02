# /review-module — 08-profit-reports

**Date:** 2026-08-02 · **Reviewer:** implementing engineer (self-review, per DoD § Review)
**Depends on:** 06 (revenue) · 07 (expenses) · 14 (metric library + snapshots) · 21 (staff cost, minimal surface)
**Tier 3.** No owned tables — a pure consumer that reconciles the lower tiers.

Checklist source: [`.claude/commands/review-module.md`](../../.claude/commands/review-module.md)

---

## 1. Traceability — AC → test

**6 domain unit tests** + **3 integration tests** + **2 e2e**. Coverage per AC below.

| AC | Requirement | Covered by |
|---|---|---|
| AC-1 | Profit = ₹6,80,000 − (₹2,10,000 + ₹1,50,000) = ₹3,20,000 | `profit` (unit) · `reports` (integration, exact) |
| AC-2 | Matches the dashboard to the paisa (no divergent math) | reuses 14's `profit`/`occupancy`/`adr`/`revpar` + 06/07 sources (shared functions) |
| AC-3 | Closed = snapshot expense; open = live | revenue/expense from immutable folio/expense rows — **live == snapshot barring back-dated approval (R-16)** |
| AC-4 | Revenue by category, expenses by head, 14 metrics | `reports` (breakdown) · e2e (view) |
| AC-5 | Segments by source / corporate / agent | `revenueSegments` (corporates + source) — agents R-17 |
| AC-6 | Consolidation scoped to the caller's properties | `profitReport` takes scoped `propertyIds`; `db.scoped` confines reads |
| AC-7 | No `report:view-financial` → FORBIDDEN | `reports` (Housekeeping rejected) · e2e |
| AC-8 | Staff cost counted ONCE, from payroll, never a 07 STAFF entry | `profit`/`reports` (staffCost separate; `expenseByHead.STAFF` absent) |
| AC-9 | Daily/partial view apportions staff cost evenly; full month reconciles | `profit` (apportion 31 days) · `reports` (single-day ₹4,838.71) |

---

## 2. Invariants

| Invariant | Status |
|---|---|
| No divergent metric math | ✅ imports 14's `profit`/`occupancy`/`adr`/`revpar` — one definition (AC-2) |
| Staff cost counted once | ✅ from `getFinalizedStaffCost` (21), added as a separate term, never in `expenseByHead`; 07 STAFF head is non-payroll only (AC-8) |
| Apportionment reconciles | ✅ `apportionStaffCost` full-month = finalized net; daily = round(net ÷ days) (AC-9) |
| Money in paise | ✅ throughout; Decimal for apportionment rounding |
| Read-only, scoped | ✅ no tables owned, no events; `report:view-financial` + property scope (AC-6/7) |

---

## Decisions

### D-1 · Minimal `features/payroll` surface before 21 (ADR-0006 pattern)
08 needs finalized staff cost, which must come from payroll, not a 07 STAFF expense. `getFinalizedStaffCost`
reads FINALIZED `PayrollRun` net for the month; 21 expands it. A month with no finalized run
contributes 0.

### D-2 · Revenue/expense read from live rows (immutable for closed dates)
Folio lines and approved expenses are append-only, so a live sum over a closed date equals its
snapshot — 08 reconciles with 14 (AC-2) without duplicating the snapshot read. The one gap is a
back-dated expense approval after close (R-16).

---

## Findings

### F-1 · Non-blocking · Multi-month range uses the start month for staff apportionment
`profitReport` derives the payroll month from the range start. A range spanning two months apportions
from the first month's finalized net. Typical reports are per-month (the UI uses the current month).
**Action:** sum per-month finalized nets when a range crosses a month boundary.

### F-2 · Non-blocking · Segments: corporates + source; agents + export pending
`revenueSegments` returns corporates (via 14) and by-source; travel-agent segmentation and the export
handoff to 15-search-export are follow-ups (15 not built yet).

---

## Carried risks

- **R-1..R-15** from earlier modules — unchanged.
- **R-16 (new)** Closed-date expense uses the live 07 rollup, which equals `DailyStatSnapshot.expensePaise`
  except when an expense is approved AFTER the date closed (back-dated). The snapshot is the immutable
  record (14); 08 should prefer it for closed dates — a refinement.
- **R-17 (new)** Travel-agent segmentation + export handoff to 15 pending (AC-5 partial; 15 not built).
