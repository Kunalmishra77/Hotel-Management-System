# 12 · Communications — User Stories & Acceptance Criteria

Roles per `rules/user-roles.md`; consent/PII per `compliance.md`; provider behavior per `integrations.md`.

## Test Fixtures
| Ref | Entity | Value |
|---|---|---|
| PROP-A | Property | tz Asia/Kolkata, quiet hours 21:00–08:00 |
| G-RAVI | Guest | WhatsApp opted-in; marketing consent = granted |
| G-NOAD | Guest | marketing consent = opted-out; transactional allowed |
| TPL-CONF | Template | `BOOKING_CONFIRMATION` / WhatsApp / en (has approved providerTemplateId) |
| TPL-MKTG | Template | `FESTIVAL_OFFER` / WhatsApp / en (marketing) |
| MODE | Messaging mode | `sandbox` (no live creds) |
| U-MGR | User | MANAGER (`communication:send`, `communication:template-manage`) |
| U-REC | User | RECEPTION (`communication:send` only) |
| CLOCK | Injected clock | for scheduled/quiet-hours/idempotency tests |

## US-1 — Event-driven transactional messages
- **AC-1:** Given `ReservationCreated` (direct source) for G-RAVI, when the automation matches, then TPL-CONF is rendered with booking context and a `MessageLog(QUEUED)` is enqueued via the outbox — not sent inline in the booking request. (FR-3)
- **AC-2:** Given MODE=sandbox, when the worker dispatches it, then no external call is made and status advances QUEUED→SENT→DELIVERED deterministically; the app runs end-to-end. (FR-4)
- **AC-3:** Given a live channel with an approved `providerTemplateId`, when dispatched, then `MessagingProvider.sendTemplate` is called; success → SENT + providerRef, error → FAILED + error. (FR-5)
- **AC-4:** Given a WhatsApp template with **no** approved providerTemplateId, when a live send is attempted, then it is **blocked** (only sandbox path allowed). (FR-9)

## US-2 — Delivery status & dedupe
- **AC-5:** Given a signed delivery webhook, when it arrives, then signature is verified, deduped on providerRef via inbox, and status advances (SENT→DELIVERED/READ/FAILED). (FR-6)
- **AC-6:** Given a duplicate delivery webhook (same providerRef), when it arrives again, then ignored — no double status flip/count. (FR-22)
- **AC-7:** Given a send fails repeatedly, when retries exhaust, then the message is dead-lettered + admin alerted; the originating booking was never blocked. (FR-7)

## US-3 — Consent, marketing, quiet hours
- **AC-8:** Given G-NOAD (marketing opted-out), when a `FESTIVAL_OFFER` campaign runs, then no message is sent to them; a transactional confirmation to the same guest **is** sent (purpose-limitation). (FR-10)
- **AC-9:** Given G-RAVI sends `STOP` (inbound), when processed, then marketing consent for WhatsApp → OPTED_OUT and future marketing on it is suppressed. (FR-11)
- **AC-10:** Given quiet hours 21:00–08:00 and a marketing send computed at 22:00, when scheduled, then it defers to the next allowed window; a transactional message at 22:00 sends immediately. (FR-21)

## US-4 — Scheduled automations & campaigns
- **AC-11:** Given a pre-arrival reminder at check-in − 24h (property tz), when the pg-boss tick runs, then the message is enqueued exactly once per reservation/automation (idempotent). (FR-13)
- **AC-12:** Given a marketing campaign to a segment, when U-MGR approves it, then exactly one `MessageLog` per eligible (consented) recipient is fanned out. (FR-14)
- **AC-13:** Given an inactive automation/template, when its trigger fires, then no message is generated. (FR-17)

## US-5 — Feedback & reminders
- **AC-14:** Given an after-checkout review reply from a guest, when received, then a `Feedback` row is created and `FeedbackReceived` emitted (for 18 sentiment). (FR-16)
- **AC-15:** Given `PaymentDueDetected`, when consumed, then a templated payment reminder is enqueued on the guest's opted-in channel. (FR-20)

## Negative / safety
- **AC-16:** Given a template referencing `{{roomNumber}}` absent from the event context, when rendered, then `RENDER_MISSING_VAR` and the message is dead-lettered — never a broken partial send. (FR-18)
- **AC-17:** Given U-REC (no `communication:template-manage`), when editing a template or launching a campaign, then `FORBIDDEN`. (FR-19)
- **AC-18:** Assert logs/provider payloads carry only recipient + rendered body — no Aadhaar/ID/financial detail beyond the template's purpose. (FR-15)
