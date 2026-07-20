# ADR-0003: Provider abstraction with sandbox-by-default

- **Status:** Accepted
- **Date:** 2026-07-18

## Context
Payments, WhatsApp, SMS, email, OTA, accounting, and the LLM all require external accounts, KYC, certification (OTA), or DLT (SMS) that the client must obtain — and that dev/CI can't have. We must build and verify everything now regardless.

## Decision
Every external dependency sits behind an interface in `lib/{payments,messaging,ai,integrations}`. A mode env selects sandbox/mock vs live. **With no live credentials the app runs fully** (outbox-logged messages, simulated payments, deterministic AI stubs). Going live = config change, not code change.

## Consequences
- (+) Full end-to-end app + tests with zero external accounts; honest about live blockers in specs.
- (+) Swap providers (Razorpay↔Cashfree, Meta↔Gupshup, Anthropic↔OpenAI) with a new adapter only.
- (−) Extra adapter/interface layer and contract tests to maintain.

## Alternatives
- Direct SDK calls — couples code to vendors, blocks offline dev/CI, hides the certification reality; rejected.
