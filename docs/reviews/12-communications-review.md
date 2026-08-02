# /review-module — 12-communications

**Date:** 2026-08-02 · **Reviewer:** implementing engineer (self-review, per DoD § Review)
**Built by:** a delegated subagent; **integrated + verified serially by the parent** (typecheck, lint, full DB test suite, e2e).
**Depends on:** 00 (events/outbox/inbox/audit/storage) · 03/04/06 (event payloads it consumes) · integrations.md (provider abstraction).
**Tier 4.** Owns `MessageTemplate`, `MessageAutomation`, `Campaign`, `CommunicationConsent`, `MessagingAccount`, `MessageLog`, `Feedback` writes.

---

## 1. Traceability — AC → test

**29 unit** + **12 integration** + **1 e2e** (×2 projects).

| AC | Requirement | Covered by |
|---|---|---|
| AC-1 | Event → render → enqueue outbox (not inline) | integration (consumer enqueues, no inline send) |
| AC-2 | Sandbox worker: deterministic status, no external call | integration (QUEUED→DELIVERED) · `provider` unit |
| AC-3/4 | Live dispatch via provider; approved-template gate | integration (live-send gate; `TEMPLATE_NOT_APPROVED`) |
| AC-5/6 | Delivery webhook: signature + inbox dedupe + status advance | integration (dedupe; bad signature rejected) |
| AC-7 | Retry/backoff → dead-letter + admin alert | integration (retry → dead-letter) |
| AC-8 | Marketing consent + purpose-limitation | `consent` unit · integration (transactional exempt) |
| AC-9 | Opt-out inbound → consent + suppression | integration (opt-out suppresses marketing) |
| AC-10 | Quiet hours | `quiet-hours` unit |
| AC-11 | Scheduled sends idempotent per (reservation, automation) | `schedule` unit |
| AC-12 | Campaign fan-out one/eligible + approval | integration |
| AC-13 | Inactive automation/template → no send | integration |
| AC-14 | Feedback capture → `FeedbackReceived`; `recordSentiment` writeback | integration |
| AC-15 | `PaymentDueDetected` → reminder, idempotent per (folioId, businessDate) | integration |
| AC-16 | `renderTemplate` incl. `RENDER_MISSING_VAR` | `render` unit |
| AC-17 | RBAC: template/campaign mgmt denied without perm | integration |
| AC-18 | PII minimization in logs/provider payloads | integration (no PII on log; body on event only) |

---

## 2. Invariants

| Invariant | Status |
|---|---|
| Sending never on the write path | ✅ mutation emits event; worker renders + dispatches (design.md) |
| Provider behind interface; mock default, zero-credential | ✅ `src/lib/messaging` — `MockProvider` default, live gated by `mode`; honest `LIVE_BLOCKERS` (WABA/BSP, DLT, DKIM) |
| Idempotency | ✅ scheduled per (automation, reservation); reminder per (folioId, businessDate) via inbox key; webhooks deduped |
| PII minimization | ✅ body travels on the event, not the `MessageLog` row; addresses masked in the log/UI |
| Canonical write path | ✅ zod → authorize → tx → emit → audit → Result |
| Cross-module reads via payload, not foreign SELECT | ✅ consumer reads guestId/propertyId from event payloads |

---

## Decisions

### D-1 · Rendered body rides the event, not the `MessageLog` row
The schema has no `body` column (authoritative). The consumer carries the rendered body on the
`MessageQueued` event payload and the worker re-reads it via `MessageLog.triggeredByEvent` — keeping
sending off the write path and PII off the persisted row.

### D-2 · `recordSentiment` is 12's action; 18 calls it
12 owns every `Feedback` write. It exposes `recordSentiment({feedbackId,label,score})` (authorized,
audited) that 18 calls to write a sentiment label back — 18 never touches `Feedback` directly.

---

## Carried risks

- **R-22 (new)** Config mutations (template/automation/campaign) audit but emit no domain event — no such
  event type exists in the catalog. If FR-19's "emits its domain event" is to be literal, add
  `TemplateChanged`/`CampaignLaunched` to the catalog (deliberately deferred; audit already records them).
- **R-23 (new)** `SegmentUpdated` consumption (dynamic campaign refresh from 18's segments) is not wired —
  no AC requires it; campaign recipients are passed explicitly today.
- **R-24 (new)** Live provider adapters return honest failures (no SDK wired) pending the client's
  BSP/DLT/DKIM onboarding — the mock covers every path (integrations.md).
