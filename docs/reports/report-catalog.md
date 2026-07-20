# Report & Metric Catalog

Every metric is defined **once** in [`.claude/rules/reporting.md`](../../.claude/rules/reporting.md) and computed once in `features/analytics/domain` (reused by 08 and the dashboard). No screen recomputes a metric differently. Money in paise (₹ at the edge); percentages in basis points internally.

## Metric definitions (canonical)
| Metric | Formula |
|---|---|
| Occupancy % | occupied room-nights ÷ available room-nights |
| ADR / ARR | room revenue ÷ occupied room-nights (room revenue only, tax-excluded) |
| RevPAR | room revenue ÷ available room-nights = ADR × Occupancy% |
| Revenue | Σ folio charges by category, net-of-discount, tax-excluded |
| Expenses | Σ approved expense entries by head + payroll cost (counted once) |
| Profit | Revenue − Expenses |
| Outstanding | Σ folio balances due |

## Live dashboard (14 · client §13)
Today's check-ins/outs, vacant/occupied/maintenance rooms, revenue today, expenses today, pending payments, advance bookings, cancelled bookings, monthly occupancy, revenue trends, top corporate clients, top travel agents, repeat guests — real-time (SSE), per property + consolidated, permission-filtered.

## Reports
| Report | Spec | Content |
|---|---|---|
| Income vs Expense / Profit | [08](../../specs/08-profit-reports/) | daily/monthly/property/consolidated profit; revenue by category; expenses by head |
| Occupancy & rate | [14](../../specs/14-dashboard-analytics/) | occupancy%, ADR/ARR, RevPAR; daily & monthly trends |
| Revenue segmentation | [08](../../specs/08-profit-reports/), [25](../../specs/25-corporate-crm/) | by booking source, corporate client, travel agent (top-N by revenue + room-nights) |
| Guest history | [05](../../specs/05-guest-history/) | visits, room-nights, revenue, outstanding, preferences, bills, feedback |
| Expense analysis | [07](../../specs/07-expense-management/) | daily/monthly/property/head rollups |
| Corporate statement | [25](../../specs/25-corporate-crm/) | charges/payments/balance + aging; agent commission |
| Payroll register | [21](../../specs/21-payroll/) | run + payslips |
| Channel health | [13](../../specs/13-booking-channel-integrations/) | sync status, dead-letter counts |
| Accounting reconciliation | [22](../../specs/22-accounting-sync/) | synced/pending/failed per provider |

## Data integrity
- Closed business dates read **immutable `DailyStatSnapshot`**; open dates read live (night audit boundary).
- Reports reconcile **to the paisa** with the live dashboard and the folios (guarded by reconciliation tests).
- Export any report/result to Excel/PDF/CSV via [15](../../specs/15-search-export/), PII-gated + audited.
