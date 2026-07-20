# 12 · Communications — Requirements

> Source: client doc §11. Read with `.claude/rules/integrations.md` (provider abstraction, sandbox↔live, DLT/BSP blockers), `rules/compliance.md` (DPDP consent, PII minimization), `rules/business-rules.md` §20, `docs/architecture/domain-events.md`, `prisma/schema.prisma`. Depth bar: `specs/03-reservations/*`.

## Purpose & scope
Send the right message on WhatsApp / Email / SMS at the right moment, driven by domain events, using per-channel/per-language templates — and record every send with its delivery status. All sending goes through a provider-abstracted messaging layer that **runs fully in sandbox/outbox with zero external accounts**; going live is a config change gated by external onboarding the client must complete.

**In scope:** `MessageTemplate` management per channel/language; event-triggered and scheduled **automations** grouped as *before-arrival / during-stay / after-checkout / marketing* (§11); the outbox that turns domain events into `MessageLog` rows; provider dispatch via a `MessagingProvider` interface; inbound **delivery-status** and **opt-out** webhooks; **consent** (DPDP) enforcement for marketing; retry/backoff/dead-letter; capturing post-checkout feedback and emitting `FeedbackReceived`.

**Out of scope:** the concrete provider SDK adapters live in `src/lib/messaging` (infrastructure, not this module's business surface — this spec defines the *interface* they satisfy); detecting that a payment is due (06/14 emit `PaymentDueDetected`); AI-drafted/phrased copy (18 — this module renders deterministic templates and consumes 18's drafts as an optional body source); OTA guest messaging (13); the public chatbot (18/23).

## Dependencies
- **Tier 0:** 00-platform (auth, tenancy, **DomainEvent outbox + pg-boss dispatch**, AuditLog, IntegrationInbox for inbound webhooks), 01-property-management (property, timezone, quiet-hours config).
- **Reads:** 04-guest-crm (guest contact + consent), 03-reservations / 06-billing (event context only — via event payloads, never foreign SELECTs).
- **Consumes events from:** 03, 06, 14, 11, 20, and its own feedback capture.
- **Peer (Tier 4):** 18-ai-features consumes `FeedbackReceived` (sentiment) and may supply drafted copy; this module never depends on 18 to function.
- **Downstream consumers:** none block the front desk — comms is an event *consumer*, decoupled from every write path (`architecture.md`).

## Functional requirements (EARS)
- **FR-1 (ubiquitous):** Record every outbound message as a `MessageLog` (channel, `templateKey`, `toAddress`, `status`, `providerRef`) scoped to a property (nullable for org-level marketing) and, where known, a `guestId`.
- **FR-2 (ubiquitous):** Manage `MessageTemplate` uniquely per `(orgId, key, channel, language)`; the template is the single source of copy for that event/channel/language.
- **FR-3 (event):** When a domain event matches an active automation, resolve the template, render it with the event's context, and enqueue a `MessageLog` (`QUEUED`) via the **outbox** — never send inline in the originating request path.
- **FR-4 (state):** While a channel is in **sandbox** mode (no live credentials), record the message to the outbox and mark it `SENT` then `DELIVERED` deterministically, performing **no external call**, so the whole app runs end-to-end.
- **FR-5 (event):** When the messaging worker dispatches a `QUEUED` message, call the channel's `MessagingProvider.sendTemplate`/`sendSession`; on success set `SENT` + `providerRef`, on error set `FAILED` + `error`.
- **FR-6 (event):** When a provider delivery webhook arrives, **verify its signature first**, dedupe on `providerRef` via `IntegrationInbox`, then advance the `MessageLog` status (`SENT`→`DELIVERED`/`FAILED`/`READ`).
- **FR-7 (unwanted):** If a send fails, retry with exponential backoff up to a configured limit; on exhaustion, **dead-letter** the message and alert an admin — the originating operation is never blocked.
- **FR-8 (ubiquitous):** Select channel and language deterministically: prefer the guest's opted-in preferred channel; fall back across configured channels; fall back to language `en` when the requested-language template is absent.
- **FR-9 (state):** While a WhatsApp or SMS template is intended for **LIVE**, require an approved `providerTemplateId` (WhatsApp BSP/Meta-approved HSM, or TRAI **DLT**-registered template + sender-ID) before it can send live; without it, live sending is **blocked** and the template can only exercise the sandbox path.
- **FR-10 (unwanted):** If a message is `MARKETING` category and the recipient has not opted in (or has opted out) for that channel, do not send it; `TRANSACTIONAL` service messages (confirmation, receipt, invoice, reminder) are exempt from marketing opt-in per DPDP purpose-limitation.
- **FR-11 (event):** When a guest sends `STOP`/`UNSUBSCRIBE` (inbound webhook), record `OPTED_OUT` consent for that channel's marketing and suppress all future marketing on it.
- **FR-12 (ubiquitous):** Provide automations for the four §11 categories — **before-arrival**, **during-stay**, **after-checkout**, **marketing** — each mapping a trigger (a domain event, or a schedule with a property-local offset) to a template + channel + audience filter.
- **FR-13 (event):** When a scheduled automation's send time arrives (e.g. pre-arrival reminder at check-in − 24h in property tz), enqueue the message; a `pg-boss` tick computes due sends **idempotently** (a send is produced at most once per reservation/automation).
- **FR-14 (event):** When a marketing campaign targets a segment, evaluate consent per recipient, require approval (`communication:template-manage`), and fan out exactly one `MessageLog` per eligible recipient.
- **FR-15 (ubiquitous):** Send the provider and store the log with **minimum PII**: recipient address + rendered body only; never Aadhaar/ID/financial detail beyond the template's stated purpose; logs redact per `compliance.md`.
- **FR-16 (event):** When a guest responds to an after-checkout review request, create a `Feedback` row and emit `FeedbackReceived` (consumed by 18 for sentiment); 18 writes the classified label back via this module's `recordSentiment(feedbackId, label, score)` action (18 never writes `Feedback` directly — `contracts.md`).
- **FR-17 (state):** While an automation or template is inactive, generate no messages from it.
- **FR-18 (unwanted):** If a render references a variable absent from the event context, fail the render with `RENDER_MISSING_VAR` and dead-letter the message — never send a partially-rendered/broken message.
- **FR-19 (ubiquitous):** Every template change, automation change, manual send, campaign send, and consent change is authorized server-side, property/org-scoped, audited, and emits its domain event (`business-rules.md` §20).
- **FR-20 (event):** When `PaymentDueDetected` occurs, enqueue a templated payment reminder on the guest's opted-in channel (deterministic trigger; copy may be phrased by 18 but the trigger and gating are owned here). Because **both 06 (checkout) and 14 (night-audit close) emit `PaymentDueDetected`** for the same folio/day, the consumer is **idempotent per `(folioId, businessDate)`** (beyond event-id dedupe) — at most one reminder per folio per day.
- **FR-21 (state):** While configurable property-local **quiet hours** (`Property.quietHoursStart`/`Property.quietHoursEnd`) are in effect, defer `MARKETING` sends to the next allowed window; `TRANSACTIONAL` messages are unaffected.
- **FR-22 (unwanted):** If a duplicate delivery webhook (same `providerRef`) arrives, ignore it idempotently — no double status flip, no double count.
- **FR-23 (ubiquitous):** Hold messaging config as `MessagingAccount` per `(channel, provider, mode)` so that swapping providers or going live is a **config change, never a code change** (`integrations.md` golden rule).
- **FR-24 (ubiquitous):** Render the §11 before-arrival / during-stay templates with the **per-property** merge content stored on `Property` — `wifiSsid`/`wifiPassword` (Wi-Fi password message), `houseRules`, `emergencyContact`, `locationMapUrl` (location map), `checkInInstructions` — supplied by the render context from 01's query surface (not hard-coded, not in the org-level template body). A template referencing a merge field that is unset for the property fails render with `RENDER_MISSING_VAR` and dead-letters (FR-18), never sending a blank Wi-Fi/house-rules message.
- **FR-25 (event):** When a **marketing campaign** distributes a **discount coupon** (§11), the `Campaign.couponId` names the `Coupon` (owned by 06); the rendered marketing message includes that coupon's `code`, and the coupon is redeemed later by the guest at booking/checkout via 06 (12 only *sends* the code — it never applies the discount). A paused/expired coupon is not sent.

## Data owned
`MessageTemplate`, `MessageLog`, `Feedback` (capture side; 18 writes the sentiment label back via `recordSentiment`). **Confirmed present in the canonical schema:** `MessageAutomation`, `Campaign`, `CommunicationConsent`, `MessagingAccount`, plus the `category`/`scheduledFor`/`attempts`/`deadLetteredAt` fields and `@@index([propertyId, createdAt])` on `MessageLog`. Reads guest contact via 04's query surface; consumes event payloads (never foreign SELECTs into 03/06).

## Non-functional (cited)
`non-functional-requirements.md`: integration failures **degrade gracefully** (retry/backoff/dead-letter) and never block the front desk; event→enqueue is async off the write path (mutation p95 < 800ms unaffected); worker dispatch is at-least-once with idempotent consumers; delivery-status update latency is best-effort (not on any user-blocking path). Search/list of message history stays within list budgets via indexed, paginated queries.

## Business rules referenced
`business-rules.md` §20 (validate→authorize→transaction→event→audit on every mutation), §17 (guest data derived, not duplicated). `integrations.md` (interface-behind-provider, sandbox↔live gating, outbox/inbox, signature-verified webhooks, honest live blockers: **WhatsApp BSP/Meta approval, SMS TRAI DLT registration, Email SPF/DKIM domain verification**). `compliance.md` (DPDP purpose-limitation & consent, PII minimization, India data region).
