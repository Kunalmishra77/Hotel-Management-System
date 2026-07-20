# 18 · AI Features — User Stories & Acceptance Criteria

Roles per `rules/user-roles.md`. Default provider = `mock` (deterministic).

## Test Fixtures
| Ref | Value |
|---|---|
| PROVIDER | `AI_PROVIDER=mock` (deterministic stubs) |
| U-MGR | MANAGER (`ai:use`, `report:view-financial`) |
| U-REC | RECEPTION (`ai:use`) |
| FB-NEG | Feedback "AC never worked, terrible" |
| GUESTS | seeded guests incl. Bangalore repeat visitors |

## US-1 — Provider abstraction
- **AC-1:** Given PROVIDER=mock (no key), when any AI feature runs, then it returns deterministic output and the app/tests pass without external calls. (FR-1)
- **AC-2:** Given a structured-output request, when the provider returns, then it is zod-validated before use. (FR-1)

## US-2 — Chatbot (read-only, staff-only)
- **AC-3:** Given U-REC (staff, `ai:use`) asks the chatbot "any rooms for this weekend?" via the session-gated `/api/ai/*` surface, when answered, then the chatbot uses read-only availability tools and never exposes other guests' PII or confirms a booking without server rules. A caller without `ai:use` (or an unauthenticated public request) gets `FORBIDDEN` — the public guest-site chatbot is owned by 23, not here. (FR-3/2/10)

## US-3 — NL search (no raw SQL)
- **AC-4:** Given U-MGR asks "guests from Bangalore who stayed >2× in the last 2 years", when compiled, then it becomes 15's **`StructuredQuery`** passed through `15.validateStructuredQuery` (field-whitelisted), runs with U-MGR's scope, and returns masked results — **no raw SQL** is produced. (FR-4)
- **AC-5:** Given a compiled query references a non-whitelisted field, when validated, then rejected (guardrail). (FR-4)

## US-4 — Sentiment, forecast, rates, segments
- **AC-6:** Given FB-NEG, when `FeedbackReceived` fires, then sentiment = NEGATIVE + score is written back via `12.recordSentiment(feedbackId, 'NEGATIVE', score)` (18 never writes `Feedback` directly) and `SentimentClassified` is emitted; it is surfaced, not auto-acted. (FR-5)
- **AC-7:** Given a revenue forecast request, when produced, then the **numbers come from the time-series/stats** and the LLM only phrases the narrative. (FR-6)
- **AC-8:** Given a rate-suggestion request, when 24 calls `18.suggestRates(...)`, then `RateSuggestion[]` is returned and **24 writes the `DynamicRate(SUGGESTED)` row** requiring approval before any rate publishes — 18 never writes `DynamicRate`. (FR-7)
- **AC-9:** Given segmentation, when run, then guests are clustered into advisory segments for 12. (FR-8)

## US-5 — Guardrails
- **AC-10:** Given any AI feature, when it would change state, then it calls the owning module's authorized/audited action — the LLM never mutates directly. (FR-2)
- **AC-11:** Given prompts, then Aadhaar/IDs/financial detail beyond need are redacted; AI actions on guest/money paths are logged. (FR-9)
- **AC-12:** Given a user without `ai:use`, when invoking AI, then `FORBIDDEN`. (FR-10)
