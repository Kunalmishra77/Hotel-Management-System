# Automation Catalog

Every automated behavior in the system, in one place. Two engines drive automation:
- **Scheduled jobs** — `pg-boss` cron/timers (no extra infra; see [tech-stack.md](../../.claude/rules/tech-stack.md)).
- **Event-driven** — domain events dispatched via the outbox to idempotent consumers ([domain-events.md](../architecture/domain-events.md)). Consumers never poll tables.

Principle: automations are **byproducts of events**, decoupled from write paths — adding one never touches billing/reservations.

## A. Scheduled jobs (pg-boss)

| Job | Owner spec | Cadence | Action | Degrades to |
|---|---|---|---|---|
| **Night audit** | [14](../../specs/14-dashboard-analytics/) | per-property `nightAuditTime` | post room-night charges (06) → mark no-shows (03) → write immutable `DailyStatSnapshot` → roll business date → lock day | idempotent re-run |
| **Daily backup** | [00](../../specs/00-platform/) | daily | encrypted DB + object-storage backup to India region; record `BackupRun`; alert admin | local/sandbox target |
| **Comms schedule tick** | [12](../../specs/12-communications/) | frequent tick | compute due pre-arrival / during-stay / after-checkout / marketing sends idempotently | sandbox outbox |
| **Hold expiry sweeper** | [03](../../specs/03-reservations/), [23](../../specs/23-booking-engine/) | frequent | release ENQUIRY holds past TTL so inventory returns | — |
| **OTA sync** | [13](../../specs/13-booking-channel-integrations/) | interval + webhook | pull reservations, push availability/rates to active channels | mock adapter |
| **Preventive maintenance** | [11](../../specs/11-maintenance/) | per schedule | emit `MaintenanceScheduled` ahead of due date | — |
| **Dynamic pricing engine** | [24](../../specs/24-dynamic-pricing/) | daily/interval | compute rate suggestions (occupancy/season/lead-time) → `DynamicRate(SUGGESTED)` | base-rate fallback |
| **Accounting sync worker** | [22](../../specs/22-accounting-sync/) | on event + retry | push invoices/payments/expenses/payroll to Tally/Zoho, idempotent | sandbox log-only |
| **Outbox dispatcher** | [00](../../specs/00-platform/) | continuous | publish undispatched `DomainEvent`s at-least-once, per-aggregate order | — |
| **Inbox processor** | [00](../../specs/00-platform/) | continuous | process signature-verified inbound webhooks exactly once | — |
| **Guest-stats reconciler** | [05](../../specs/05-guest-history/) | periodic | recompute `GuestStatsSnapshot` from source on drift | — |

## B. Event-driven automations (event → consumer → action)

| Domain event | Emitted by | Triggers |
|---|---|---|
| `ReservationCreated` | 03 | 12 booking confirmation · 14 pace · 13 availability push |
| `ReservationCancelled` | 03 | 12 notice · 13 inventory release · 14 |
| `GuestCheckedIn` | 03/04 | 12 welcome (Wi-Fi/house rules) · 10 housekeeping · 14 |
| `GuestCheckedOut` | 03/06 | 12 thank-you + Google review + feedback form + invoice copy · 10 cleaning task · 14 · 05 history |
| `FolioCharged` | 06/19 | 14 revenue · 05 history  (22 consumes `InvoiceIssued`, not raw charges) |
| `PaymentReceived` | 06 | 12 receipt · 14 · 22 · 05 · 25 receivable |
| `InvoiceIssued` | 06 | 12 invoice copy · 22 accounting |
| `PaymentDueDetected` | 06/14 | 12 payment reminder |
| `ExpenseRecorded` | 07 | 14 · 22 |
| `PayrollFinalized` | 21 | 08/14 staff cost · 22 salary journal |
| `FeedbackReceived` | 12 | 18 sentiment analysis |
| `NightAuditCompleted` | 14 | 08 reports · analytics snapshot read |
| `ChannelReservationPulled` | 13 | 03 create · 12 confirmation |
| `PosOrderSettled` | 19 | 20 stock deduction (per recipe) |
| `LowStockDetected` | 20 | 12 reorder reminder |
| `MaintenanceScheduled` | 11 | 12 reminder |
| `RoomStatusChanged` | 02/10 | 17/SSE realtime · 01/14 live occupancy |
| `DynamicRateApproved` | 24 | 13 rate push · 03/23 resolution |

## C. Guest communication automations (client doc §11)

| Category | Trigger | Messages |
|---|---|---|
| **Before arrival** | `ReservationCreated`; schedule check-in−24h | booking confirmation, location map, check-in instructions |
| **During stay** | `GuestCheckedIn` | welcome, Wi-Fi password, house rules, emergency contact |
| **After check-out** | `GuestCheckedOut` | thank-you, Google review link, feedback form, invoice copy |
| **Marketing** | schedule + segment (consent-gated) | birthday, anniversary, festival greetings, offers, seasonal promos, coupons |

All sends: channel = guest's opted-in preference (WhatsApp/Email/SMS), consent-checked for marketing, quiet-hours-aware, rendered from approved templates, logged with delivery status. LIVE requires the provider approvals in the [integration catalog](../integrations/catalog.md).

## Guarantees
Outbox = no lost events (persisted in the mutation's transaction). At-least-once delivery + idempotent consumers (dedupe on event id). Inbox dedupe on provider id. Failures retry→dead-letter→admin alert; **the front desk is never blocked**.
