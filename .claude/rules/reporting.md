# Reporting & Metrics (Canonical Definitions)

Every metric is defined **once** here and computed **one** way in `features/analytics`/`features/reports`. No screen recomputes a metric differently. All are property-scoped and date-ranged; financial figures come from folios/invoices, not estimates.

## Occupancy & rate
- **Available room-nights** = rooms sellable × nights in range (exclude out-of-order/maintenance blocks).
- **Occupied room-nights** = sold room-nights (in-house/checked-out; excludes cancelled/no-show).
- **Occupancy %** = Occupied ÷ Available × 100.
- **Two distinct occupancy figures — don't conflate:** (a) the **room-night occupancy** above, computed over a date range by `14` (the metric authority) for reports/snapshots; (b) the **live point-in-time status rollup** on the property overview (`01`) = rooms currently `OCCUPIED` ÷ (total active rooms − `UNDER_MAINTENANCE`). `RESERVED` rooms count as sold in (a) for their booked nights but are **not** `OCCUPIED` in the live (b) rollup. `01` must label its tile as current-status occupancy, not the ADR/RevPAR denominator.
- **ADR / ARR** (Average Daily/Room Rate) = Room revenue ÷ Occupied room-nights. *Room revenue only* — excludes F&B, taxes, other charges.
- **RevPAR** = Room revenue ÷ Available room-nights = ADR × Occupancy%.

## Money
- **Revenue** = Σ folio charges by category (room, F&B, laundry, transfer, misc), net of discounts, **excluding tax** unless a report is explicitly tax-inclusive.
- **Expenses** = Σ approved `07` expense entries by head **(excluding the STAFF head's salary spend)** **+** finalized payroll staff cost from `21` (`PayrollFinalized`). Staff salary is counted **exactly once** — from payroll, never also as a `07` STAFF expense. (The `07` STAFF head is only for non-payroll staff spend — reimbursements, off-cycle advances.)
- **Profit** = Revenue − Expenses (as defined above), per day/month/property (`08-profit-reports`).
- **Staff-cost grain**: payroll is monthly (`PayrollRun` per `(property, month)`). For a **daily** or partial-month profit view, staff cost is spread **evenly across the month's days** (monthly net ÷ days-in-month × days-in-range). `DailyStatSnapshot.expensePaise` carries **07 approved expenses only**; the daily-apportioned staff cost is added by `08` at report time (documented so the two never double count).
- **Outstanding / pending payments** = Σ folio balances due (charges+tax − payments).

## Segmented views (§7, §13)
- Revenue by **booking source**, **corporate client**, **travel agent**.
- Top corporate clients / travel agents / repeat guests (by revenue and room-nights).
- Trends: daily & monthly occupancy and revenue; cancellations; advance bookings pace.

## Dashboard (live — §13)
Today's check-ins, check-outs, vacant/occupied rooms, revenue today, expenses today, pending payments, advance bookings, cancelled bookings — all real-time, per property and consolidated.

## Rules
- Closed business dates read **immutable night-audit snapshots**; open dates read live state (`business-rules.md` §14–15).
- Currency in paise internally; format to ₹ at the edge. Percentages rounded for display only, never for further math.
