# /review-module — 18-ai-features

**Date:** 2026-08-02 · **Reviewer:** implementing engineer (self-review, per DoD § Review)
**Built by:** a delegated subagent; **integrated + verified serially by the parent** (typecheck, lint, full DB test suite, e2e).
**Depends on:** 15 (`validateStructuredQuery`/`runStructuredQuery`) · 12 (`recordSentiment`) · 03 (availability helper) · 00 (events/audit/auth).
**Tier 4.** Owns `AiInteractionLog`, `GuestSegment` writes. Runs fully on the **mock provider** with zero API keys.

---

## 1. Traceability — AC → test

**25 unit** + **9 integration** + **1 e2e** (×2 projects).

| AC | Requirement | Covered by |
|---|---|---|
| AC-1 | Provider-agnostic; mock default, deterministic | `provider-mock` unit (no network, deterministic embed) |
| AC-2 | Structured output zod-validated | `provider-mock` unit (`completeStructured` validates/rejects) |
| AC-3/10 | Chatbot read-only tool-use; no mutation tools; `ai:use`-gated | `provider-mock` + integration (unknown tool refused; no mutation tools) |
| AC-4/5 | NL search → 15 `StructuredQuery`; non-whitelisted rejected | integration (`INVALID_QUERY`) · e2e (masked cards) |
| AC-6 | Sentiment → `recordSentiment` + `SentimentClassified`; 18 never writes Feedback | integration (call asserted; Feedback untouched by 18) |
| AC-7 | Forecast numbers from stats, LLM narrative only | `forecast` unit · integration (grounded + narrative) |
| AC-8 | `suggestRates` → suggestions + `RateSuggested`; never writes DynamicRate | `pricing` unit · integration (zero DynamicRate written) |
| AC-9 | Segmentation → `GuestSegment` + `SegmentUpdated` | `segments` unit · integration |
| AC-11 | PII minimization in prompts + `AiInteractionLog` | `redact` unit · integration (redacted log, provider="mock") |
| AC-12 | RBAC: `ai:use` + property scope | integration (no `ai:use` → FORBIDDEN) |

---

## 2. Invariants (the ai-features.md hard rules)

| Rule | Status |
|---|---|
| LLM never mutates directly | ✅ every state change via an owning action (`recordSentiment`, `GuestSegment` writes); integration asserts no mutation tools + zero `DynamicRate`/`Feedback` writes by 18 |
| Grounding over generation | ✅ forecast/rate/segment numbers computed in pure `domain/`; LLM only phrases narrative + classifies + proposes queries |
| PII minimization | ✅ `redact.ts` scrubs Aadhaar/PAN/GSTIN/contact/amounts from prompts + `AiInteractionLog` |
| No raw SQL from the LLM | ✅ NL search compiles → 15 allow-list → `runStructuredQuery`; non-whitelisted rejected |
| Provider-agnostic, mock default | ✅ `src/lib/ai` `getLLMProvider()`; live adapters throw `AI_PROVIDER_ERROR` with no key, never hit in tests |

---

## Decisions

### D-1 · Reuse, don't reimplement, the cross-module contracts
NL search runs through 15's `validateStructuredQuery` + `runStructuredQuery`; sentiment writes via
12's `recordSentiment`; rate suggestions hand off to 24; availability reuses 03's helper. 18 writes
only `AiInteractionLog` + `GuestSegment`.

### D-2 · `feature` hint on `CompleteInput`
The provider input carries an optional `feature` hint so the deterministic mock can shape structured
output; live adapters ignore it, and every structured result is still zod-validated before use — the
spec's `{system, messages, tools?, json?}` contract is otherwise intact.

---

## Carried risks

- **R-25 (new)** Chatbot tool-use is grounded on read-only helpers; the tool registry is intentionally
  small (availability, guest lookup, FAQ). Broadening it is additive and stays behind the read-only +
  `ai:use` gate.
- **R-26 (new)** Live LLM adapters (anthropic/openai/local) are thin and unexercised (mock is the
  default + only tested path); wiring a real key is a config change, not a code change.
- **R-18** (from 15) unchanged: NL-search executes via 15's indexed structured path; p95@100k deferred.
