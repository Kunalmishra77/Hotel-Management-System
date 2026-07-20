# 18 · AI Features — Design

## Schema slice
Persists **no `Feedback` directly** — the sentiment label is written back through `12.recordSentiment(feedbackId, label, score)` (12 owns `Feedback` — `contracts.md`). **Schema notes — confirmed present in the canonical schema** (migration materializes the slice; nothing new): `AiInteractionLog(userId, feature, inputRedacted, outputRef, provider, createdAt)`; `GuestSegment(id, orgId, name, ruleJson, guestIds/cache, updatedAt)`.

## `LLMProvider` interface (`src/lib/ai`)
```ts
interface LLMProvider {
  complete(i: {system, messages, tools?, json?: ZodSchema}): Promise<LLMResult>;
  embed(texts: string[]): Promise<number[][]>;
}
```
Adapters: `anthropic`, `openai`, `local`, **`mock`** (default, deterministic). Structured outputs validated with zod before use (FR-1). Prompts/tools/schemas versioned in `lib/ai` + `features/ai`.

## Domain / capability layer — `features/ai`
- **Chatbot** (`chat.ts`): **staff-only** assistant (front desk / manager) — tool-use with **read-only** tools (availability, property FAQ) → never mutates; PII-scoped to the caller. Gated by `ai:use`; served only from the session-gated `/api/ai/*` handlers. **The public, unauthenticated guest chatbot on the booking site is out of scope here — it is owned by 23** (this module has no public surface). (FR-3)
- **NL search** (`nl-search.ts`): LLM → `StructuredQuery` object (15's contract) → `15.validateStructuredQuery` → execute via 15 (FR-4). Single-entity, field-whitelisted; never raw SQL.
- **Sentiment** (`sentiment.ts`): classify → write the label via `12.recordSentiment(feedbackId, label, score)` — **never writes `Feedback` directly** (FR-5).
- **Forecast** (`forecast.ts`): stats/time-series compute numbers; LLM phrases narrative only (FR-6).
- **Rate suggest** (`pricing.ts`): occupancy/season/lead-time model produces `RateSuggestion[]`, exposed as the public action **`suggestRates(propertyId, categoryId, range)` that 24 calls**; **24 (not 18) writes the `DynamicRate(SUGGESTED)` row** and drives approval — 18 never writes `DynamicRate` (`contracts.md`, `module-connectivity.md`). (FR-7)
- **Segmentation** (`segments.ts`): rules + embeddings → `GuestSegment` → emits `SegmentUpdated` for 12 (FR-8).
- **Reminders**: 06/12 own the trigger; AI phrases copy only.

## Guardrails (enforced in code, not prompts)
- No tool that mutates is exposed to the chatbot (FR-2).
- NL-search output must pass 15's field allow-list (FR-4).
- Prompt builder redacts Aadhaar/IDs/financials (FR-9).
- Every capability requires `ai:use` + property scope; `AiInteractionLog` records redacted input + provider (FR-9/10).

## Application (`features/ai/actions.ts`, `/api/ai/*`)
Streaming route handlers for chatbot/NL-search; server actions for sentiment/forecast/segment/rate-suggest. **Every `/api/ai/*` route and action is session-gated and requires `ai:use` (staff) + property scope** — there is no anonymous/public entry point (the guest-facing site chatbot belongs to 23). `suggestRates(propertyId, categoryId, range)` is the public cross-module action **24** invokes (24 then writes the `DynamicRate(SUGGESTED)` row). All authorized + logged (`AiInteractionLog`).

## UI — wireframes (mobile-first)
```
┌───────────────────────────┐
│ Ask PMS 🤖                │
│ "Bangalore guests, 2+ …"  │
│ ▸ 12 guests (masked)      │
│ ── Insights ──            │
│ Jul revenue trend ↑ 8%    │
│ Suggest rates → review(24)│
└───────────────────────────┘
```
Chat/NL-search bar; insights cards; "suggest rates" routes to 24 approval.

## Events
Emits: `SentimentClassified` (feedbackId, label, score → 14), `RateSuggested` (categoryId, date, suggestedPaise → 24), `SegmentUpdated` (segmentId → 12). Consumes: `FeedbackReceived` (→ sentiment). Note: the authoritative rate path is the **synchronous `24 → 18.suggestRates` call after which 24 writes `DynamicRate(SUGGESTED)`**; `RateSuggested` is a notification of the same suggestion — **18 never writes `DynamicRate`**. Catalog: `docs/architecture/domain-events.md`.

## Error catalog
`AI_VALIDATION_FAILED` (bad structured output), `INVALID_QUERY` (from 15), `FORBIDDEN`, `PROVIDER_ERROR` (fallback to mock/degraded).

## Edge cases
- No API key → mock provider; features degrade to deterministic stubs (dev/CI).
- LLM hallucinated field/number → structured-output validation / grounding rejects it.
- Chatbot asked to change data → refused; routes user to the proper action.
- Provider outage → graceful error, never blocks core ops.
