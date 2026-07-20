# 18 · AI Features — Requirements

> Source: client doc §17. Read with `rules/ai-features.md` (the whole rule), `rules/compliance.md` (PII minimization), `prisma/schema.prisma`. Depth bar: `specs/03-reservations/*`.

## Purpose & scope
Deliver the AI capabilities (§17) through a **provider-agnostic** `LLMProvider` layer with strong guardrails: the LLM proposes/phrases/classifies but **never mutates data directly** and **never writes raw SQL**. Default provider is a deterministic `mock` so the app + tests run with no key.

**In scope:** the `LLMProvider` abstraction + adapters (Anthropic/OpenAI/local/mock); a **staff-only** enquiry chatbot (read-only tool-use, `ai:use`-gated); natural-language search compiled to 15's structured query; feedback sentiment; revenue/expense forecasting (stats + LLM narrative); dynamic-rate **suggestions** exposed as `suggestRates(...)` for 24; guest segmentation; payment-reminder phrasing (trigger owned by 06/12).
**Out of scope:** the messaging send (12), the search execution (15), the rate application **and the `DynamicRate(SUGGESTED)` write** (24 — 18 only suggests), any direct data mutation (each capability calls the owning module's authorized action — sentiment via `12.recordSentiment`); the **public, unauthenticated guest chatbot on the booking site (23)** — this module's chatbot is staff-only and session-gated; model hosting.

## Dependencies
- **Tier 0–4:** 00; reads via 04/03/06/14/15 query layers; feeds 24 (rate suggestions), 12 (copy).
- **Consumed by:** staff (chatbot, NL search, insights), 24, 12.

## Data owned
None persistent; the sentiment label is written back via **`12.recordSentiment`** (12 owns `Feedback` — 18 never writes it directly). **Schema notes — confirmed present in the canonical schema:** `AiInteractionLog(id, userId, feature, inputRedacted, outputRef, provider, createdAt)` for auditability; `GuestSegment` (rule + cached membership).

## Functional requirements (EARS)
- **FR-1 (ubiquitous):** All AI calls go through `LLMProvider` (`complete`, `embed`) selected by `AI_PROVIDER`; default `mock` returns deterministic stubs so the app + tests run with **no key**.
- **FR-2 (unwanted):** The LLM shall **never mutate data directly**; every state change it proposes is executed by the owning module's validated, authorized, audited server action.
- **FR-3 (event):** When a **staff member** (front desk / manager, holding `ai:use`) asks the chatbot a question — via the session-gated `/api/ai/*` surface — answer using **read-only tools** over property/availability/FAQ; never expose PII beyond the caller's permission; cannot confirm bookings without the server's normal rules. (The chatbot is staff-only — consistent with FR-10's `ai:use` gate; the public guest-site chatbot is owned by 23.)
- **FR-4 (event):** When a natural-language search is issued, compile it into 15's **`StructuredQuery`** and pass it through `15.validateStructuredQuery` (field-whitelisted), execute with the caller's permissions, and return results — **never** emit raw SQL.
- **FR-5 (event):** When feedback arrives (`FeedbackReceived`), classify sentiment (POSITIVE/NEUTRAL/NEGATIVE + score) and write the label back via **`12.recordSentiment(feedbackId, label, score)`** (12 owns `Feedback`; 18 never writes it directly); emit `SentimentClassified`; surface, do not auto-act.
- **FR-6 (event):** When forecasting revenue/expenses is requested, compute the numbers from data (time-series/stats) and use the LLM only to **phrase the narrative** — numeric facts never come from the model. 
- **FR-7 (event):** When rate suggestions are requested, produce occupancy/season/lead-time-based `RateSuggestion[]` and return them from the public action **`suggestRates(propertyId, categoryId, range)` that 24 calls**; **24 (not 18) writes the `DynamicRate(SUGGESTED)` row** and drives human/threshold approval before any rate publishes. `RateSuggested` is emitted as a notification of the same suggestion; 18 never writes `DynamicRate` (`contracts.md`, `module-connectivity.md`).
- **FR-8 (event):** When segmentation is requested, cluster guests (rules + embeddings) into segments for 12 marketing; segments are advisory.
- **FR-9 (ubiquitous):** Send the LLM the **minimum** context; redact Aadhaar/IDs/financial detail beyond need (`compliance.md`); every AI action reaching a guest or money path is logged and reversible/approvable.
- **FR-10 (ubiquitous):** Every AI feature is authorized (`ai:use`) and property-scoped; grounding beats generation for anything numeric/factual.

## Non-functional (cited)
Runs fully on the `mock` provider in dev/CI (no key); chatbot/NL-search responses stream where useful; no AI action bypasses authz/audit; PII-minimized prompts. (`non-functional-requirements.md`, `ai-features.md`)

## Business rules referenced
`ai-features.md` (LLM never mutates; grounding over generation; PII minimization; NL→structured query; suggestions need approval). `business-rules.md` §20–21.
