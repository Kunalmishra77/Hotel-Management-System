# 12 · Communications — Tasks

Test-first for render/consent/schedule logic. Sending always off the write path. Each ends at `rules/definition-of-done.md`. `(AC-n)/(FR-n)`.

## Schema & migration
- [ ] T-1 Confirm `MessageAutomation`, `Campaign`, `CommunicationConsent`, `MessagingAccount` + `MessageLog` fields (**confirmed present in canonical schema**; migration materializes the slice); indexes `MessageLog @@index([propertyId, createdAt])` (property-scoped paginated history), `@@index([guestId])`, `@@index([status])`. (FR-1/2/23)
- [ ] T-2 Seed fixtures (templates, automations, consents, guests, sandbox account).

## Domain (write tests first)
- [ ] T-3 `renderTemplate` incl. `RENDER_MISSING_VAR`. (FR-18, AC-16)
- [ ] T-4 `selectChannelAndLanguage` preference + `en` fallback. (FR-8)
- [ ] T-5 `isMarketingAllowed` consent + purpose-limitation. (FR-10, AC-8)
- [ ] T-6 `nextAllowedSendTime` quiet hours. (FR-21, AC-10)
- [ ] T-7 `dueScheduledSends` idempotent per reservation/automation. (FR-13, AC-11)

## Application / workers (integration tests)
- [ ] T-8 Event consumer → render → enqueue outbox (not inline). (FR-3, AC-1)
- [ ] T-9 `messagingWorker` sandbox path (no call, deterministic status). (FR-4, AC-2)
- [ ] T-10 Live dispatch via provider; approved-template gate. (FR-5/9, AC-3/4)
- [ ] T-11 Delivery webhook: signature + inbox dedupe + status advance. (FR-6/22, AC-5/6)
- [ ] T-12 Retry/backoff → dead-letter + admin alert; front desk unblocked. (FR-7, AC-7)
- [ ] T-13 Opt-out inbound → consent + suppression. (FR-11, AC-9)
- [ ] T-14 Campaign fan-out one/eligible recipient + approval. (FR-14, AC-12)
- [ ] T-15 Inactive automation/template → no send. (FR-17, AC-13)
- [ ] T-16 Feedback capture → `FeedbackReceived`; expose `recordSentiment(feedbackId, label, score)` as the action 18 calls to write the sentiment label back (18 never writes `Feedback` directly). (FR-16, AC-14)
- [ ] T-17 `PaymentDueDetected` → reminder enqueued, **idempotent per `(folioId, businessDate)`** (06 and 14 both emit it → at most one reminder per folio/day). (FR-20, AC-15)
- [ ] T-18 RBAC: template/campaign management denied without perm. (FR-19, AC-17)
- [ ] T-19 PII minimization in logs/provider payloads. (FR-15, AC-18)

## Provider adapters
- [ ] T-20 `MessagingProvider` interface + MockProvider (default) + contract tests.
- [ ] T-21 WhatsApp/SMS/Email adapters (live gated); document BSP/DLT/DKIM blockers.

## UI (mobile-first)
- [ ] T-22 Templates + automations + campaign builder (consent preview). (AC-12)
- [ ] T-23 Message log with status filters.

## E2E
- [ ] T-24 Journey: booking → confirmation queued (sandbox) → delivery webhook → status DELIVERED; opt-out suppresses marketing. (AC-1/2/5/9)

## Done
- [ ] T-25 `/review-module` clean; every AC → green test; DoD satisfied.
