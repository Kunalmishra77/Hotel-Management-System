# Decision Log (lightweight)

Running log of settled decisions. Big architectural ones get a full ADR in `docs/architecture/adr/`; this is the quick index + smaller calls.

| Date | Decision | Where |
|---|---|---|
| 2026-07-18 | Full §1–19 scope built now; nothing deferred | rules/scope.md |
| 2026-07-18 | Stack: Next.js + React + TS + Postgres/Prisma + Auth.js | rules/tech-stack.md |
| 2026-07-18 | AI is provider-agnostic (`LLMProvider`), default mock | rules/ai-features.md, ADR-0003 |
| 2026-07-18 | PII: mask Aadhaar by default; full behind compliance flag; client to confirm | rules/compliance.md |
| 2026-07-18 | Modular monolith on Next.js | ADR-0001 |
| 2026-07-18 | Money = integer paise; time = UTC + property-local dates | ADR-0002 |
| 2026-07-18 | Provider abstraction, sandbox-by-default | ADR-0003 |
| 2026-07-18 | Mobile-first PWA, no native apps | ADR-0004 |
| 2026-07-18 | 26 module split (§19 expanded into full modules) | rules/scope.md |

## Open questions (need client/stakeholder input before their module is built)
- Aadhaar full-storage flag: on or off for go-live? (compliance)
- Which WhatsApp BSP, SMS provider, payment gateway will the client onboard? (integrations — affects only live activation, not the build)
- Channel manager: direct OTA certification vs aggregator? (13-booking-channel-integrations)
- Accounting target: Tally, Zoho Books, or both? (22-accounting-sync)
