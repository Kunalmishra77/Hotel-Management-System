# 18 · AI Features — Tasks

Provider-agnostic, guardrailed. Test against the mock provider (deterministic). Each ends at `rules/definition-of-done.md`. `(AC-n)/(FR-n)`.

## Provider layer
- [x] T-1 `LLMProvider` interface + `mock` (default) + `anthropic`/`openai`/`local` adapters; zod-validated structured output; contract tests. (FR-1, AC-1/2)
- [x] T-2 Confirm `AiInteractionLog` + `GuestSegment` (**confirmed present in canonical schema**; migration materializes the slice); prompt-redaction helper. (FR-9)

## Capabilities (tests vs mock)
- [x] T-3 Chatbot read-only tool-use; **staff-only, `ai:use`-gated, session-gated `/api/ai/*`** (no public entry — guest-site chatbot is 23); no mutation tools exposed; PII-scoped. (FR-2/3, AC-3/10)
- [x] T-4 NL search → 15 `StructuredQuery` via `15.validateStructuredQuery` (no raw SQL); rejects non-whitelisted field. (FR-4, AC-4/5)
- [x] T-5 Sentiment classify → write back via `12.recordSentiment(feedbackId, label, score)` (never writes `Feedback` directly) + emit `SentimentClassified`; surfaced not auto-acted. (FR-5, AC-6)
- [x] T-6 Forecast: numbers from stats, LLM narrative only. (FR-6, AC-7)
- [x] T-7 `suggestRates(propertyId, categoryId, range)` returns suggestions to **24** (24 writes the `DynamicRate(SUGGESTED)` row + approval-gates); 18 never writes `DynamicRate`. (FR-7, AC-8)
- [x] T-8 Segmentation → `GuestSegment` → emit `SegmentUpdated` (12 consumes). (FR-8, AC-9)

## Guardrails / security
- [x] T-9 Assert LLM never mutates directly (all state via owning actions). (FR-2, AC-10)
- [x] T-10 PII minimization in prompts + AiInteractionLog. (FR-9, AC-11)
- [x] T-11 RBAC: `ai:use` required + property scope. (FR-10, AC-12)

## UI (mobile-first)
- [x] T-12 Ask-PMS chat/NL-search bar + insights cards. (AC-3/4/7)

## E2E
- [x] T-13 Journey (mock): NL search → structured query → masked results; feedback → sentiment label. (AC-4/6)

## Done
- [x] T-14 `/review-module` clean; runs fully on mock; guardrails verified; every AC → green test; DoD satisfied.
