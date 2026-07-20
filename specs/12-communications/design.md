# 12 · Communications — Design

## Schema slice (from canonical `prisma/schema.prisma`)
Owns `MessageTemplate` (`@@unique([orgId,key,channel,language])`), `MessageLog`, `Feedback` (capture side). 

**Schema notes — all confirmed present in the canonical schema** (migration materializes the slice; nothing here is new):
- `MessageAutomation(id, orgId, category[BEFORE_ARRIVAL|DURING_STAY|AFTER_CHECKOUT|MARKETING], triggerEvent|scheduleOffsetMinutes, templateKey, channel, audienceFilter, isActive)` — present.
- `Campaign(id, orgId, templateKey, segmentRef, status, approvedById, scheduledAt)` — present.
- `CommunicationConsent(guestId, channel, marketingStatus[GRANTED|OPTED_OUT], updatedAt)` — present.
- `MessagingAccount(channel, provider, mode, config)` — present; swap provider/go-live via config only (FR-23).
- `MessageLog` already carries `category`, `scheduledFor`, `attempts`, `deadLetteredAt`, plus `@@index([propertyId, createdAt])` for property-scoped, paginated history.
- Quiet-hours config lives on `Property.quietHoursStart`/`Property.quietHoursEnd` (property-local, e.g. "21:00"/"08:00") — present (FR-21).

## Domain layer (pure) — `features/communications/domain/`
- `renderTemplate(body, context): string` — strict; throws `RENDER_MISSING_VAR` on unknown var (FR-18).
- `selectChannelAndLanguage(guest, automation): {channel, language}` — preference + fallbacks (FR-8).
- `isMarketingAllowed(consent, category): boolean` (FR-10).
- `nextAllowedSendTime(now, quietHours, category): Date` — `quietHours` read from `Property.quietHoursStart`/`Property.quietHoursEnd` (property-local); defers `MARKETING` only, `TRANSACTIONAL` unaffected (FR-21).
- `dueScheduledSends(reservations, automation, now, tz): Send[]` — idempotent computation (FR-13).

## Application — actions & workers (`features/communications`)
Per `api-conventions.md`. Sending is **always** off the write path (outbox).
- Event consumers (registered on 00's dispatcher): map event→automation→`renderTemplate`→enqueue `MessageLog(QUEUED)`. (FR-3)
- `messagingWorker` (pg-boss): dispatch QUEUED via `MessagingProvider`; sandbox path marks DELIVERED with no call. (FR-4/5)
- `scheduleTick` (pg-boss cron): compute due scheduled sends idempotently. (FR-13)
- Webhooks `/api/webhooks/messaging/{provider}`: verify signature → inbox dedupe → advance status / record opt-out / capture feedback. (FR-6/11/16/22)
- `manageTemplate`, `manageAutomation`, `launchCampaign` (`communication:template-manage`); `sendManual` (`communication:send`). (FR-14/19)
- **Public action `recordSentiment(feedbackId, label, score)`** — the cross-module action 18 calls to write a sentiment label onto the `Feedback` this module owns (per `contracts.md`; 18 never writes `Feedback` directly). Validates the label, updates `Feedback.sentiment/sentimentScore`, audits. (FR-16)
- **`PaymentDueDetected` reminder consumer** — enqueues a templated reminder, **idempotent per `(folioId, businessDate)`**: both 06 (checkout) and 14 (night-audit close) emit `PaymentDueDetected` for the same folio/day, so the consumer dedupes on `(folioId, businessDate)` (in addition to event-id dedupe) → **at most one reminder per folio per day**, no double-send. (FR-20)

## Provider abstraction (`src/lib/messaging`)
`MessagingProvider` per channel: `sendTemplate`, `sendSession`, `verifyWebhook`, `deliveryStatus`. Adapters: Meta WhatsApp Cloud / Gupshup / Twilio; MSG91/Twilio (SMS); Resend/SES (email); **MockProvider** (default). Live blockers (honest): WhatsApp BSP/Meta HSM approval, SMS TRAI **DLT** sender+template, email SPF/DKIM.

## UI — wireframes (mobile-first, `features/communications/components/`)
**Templates & automations:**
```
┌───────────────────────────┐
│ Communications            │
│ [Templates][Automations]  │
│ ▸ Booking confirmation  WA│
│   ✓ approved · en/hi      │
│ ▸ Pre-arrival −24h      WA│
│ ▸ Festival offer  MKTG 🔒 │
│ Message log ▸ (status)    │
└───────────────────────────┘
```
Template editor shows variables + a sandbox "preview render". Campaign builder: pick template → segment → consent-count preview → approve. Message log: filter by status/channel/guest.

## Events
Emits: `MessageQueued` (on outbox enqueue), `FeedbackReceived`, `ConsentChanged` (on opt-in/opt-out). Consumes: `ReservationCreated/Modified/Cancelled`, `GuestCheckedIn/Out`, `PaymentReceived`, `InvoiceIssued`, `PaymentDueDetected` (deduped per `(folioId, businessDate)`), `NightAuditCompleted`, `MaintenanceScheduled`, `LowStockDetected`, `SegmentUpdated` (18 → refresh campaign segment membership). Catalog: `docs/architecture/domain-events.md`.

## Sequences
**Event→send:** dispatcher delivers event → consumer resolves automation → render → enqueue `MessageLog(QUEUED)` → worker sends via provider (sandbox=no-op) → webhook updates status. **Opt-out:** inbound `STOP` → verify → set `CommunicationConsent=OPTED_OUT` → suppress future marketing.

## Error catalog
`RENDER_MISSING_VAR`, `TEMPLATE_NOT_APPROVED`, `MARKETING_NOT_CONSENTED`, `SIGNATURE_INVALID`, `FORBIDDEN`, `PROVIDER_ERROR` (→retry/dead-letter).

## Edge cases
- Missing preferred-language template → fall back to `en` (FR-8).
- Guest with no opted-in channel → transactional falls back across configured channels; marketing skipped.
- Campaign re-run → idempotent per (campaign, recipient); no double send.
- Provider outage → retries/backoff/dead-letter; front desk unaffected.
- Quiet-hours + transactional → send anyway (only marketing defers).
