# AI Features

Decision: **provider-agnostic**. All AI goes through `LLMProvider` in `src/lib/ai`; providers (Anthropic / OpenAI / local) are adapters selected by `AI_PROVIDER`. Default `mock` returns deterministic stubs so the app and tests run with no key.

## The interface
```ts
interface LLMProvider {
  complete(input: { system: string; messages: Msg[]; tools?: Tool[]; json?: Schema }): Promise<LLMResult>;
  embed(text: string[]): Promise<number[][]>;
}
```
Structured outputs are validated with zod before use. Tool-calling is how the chatbot and NL-search reach data.

## Features (§17) and how each is grounded
| Feature | Approach | Guardrail |
|---|---|---|
| Guest-enquiry chatbot | LLM + tools over property/availability/FAQ | Read-only tools; no PII to model beyond need; can't confirm bookings without server rules |
| Auto WhatsApp/email replies | Draft from templates + context | **Human-approve** for anything transactional/financial by default |
| NL search ("guests from Bangalore who stayed >2× in 2 yrs") | LLM → **structured query DSL** → validated → runs via `15-search-export` | LLM never writes raw SQL; it emits a constrained query object the server executes with the user's permissions |
| Sentiment analysis | Classify feedback | Store label + score; surface, don't auto-act |
| Revenue forecast / expense trends | Stats/time-series first; LLM for narrative | Numbers come from data, not the model's imagination |
| Dynamic rate suggestions | Occupancy/season/lead-time model (`24-dynamic-pricing`) | **Suggests**; human/threshold approves before rates publish |
| Guest segmentation | Rules + embeddings/clustering | Feeds marketing campaigns in `12-communications` |
| Payment reminders | Event/schedule-driven, templated | Deterministic triggers; LLM only phrases copy |

## Hard rules
1. **The LLM never mutates data directly.** It proposes; server code (validated, authorized, audited) executes.
2. **Grounding over generation** for anything numeric or factual — compute from the DB, use the LLM to explain/phrase.
3. **PII minimization**: send the least context needed; redact Aadhaar/IDs; respect `compliance.md`.
4. Every AI action that reaches a guest or money path is **logged and reversible/approvable**.
5. Prompts, tools, and schemas live in `lib/ai` and `features/ai`, version-controlled and testable against the mock provider.
