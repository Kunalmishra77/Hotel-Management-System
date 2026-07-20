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
| 2026-07-20 | GST place-of-supply = property state for on-premise supplies (always CGST+SGST) | rules/business-rules.md §10 |
| 2026-07-20 | Money: BigInt for accumulating totals, Int for bounded values | rules/data-model.md, business-rules §8 |
| 2026-07-20 | DB-backed sessions + per-request `revokedAt` check (force-logout); `activePropertyId` in claims | rules/security.md, spec 00/16 |
| 2026-07-20 | Independent 5-reviewer audit → 92 findings fixed; schema finalized to 66 models + `prisma validate` PASS | docs/handover-review-findings.md |
| 2026-07-20 | Manual folder audit (Pass 3): §11 coupons built as a redeemable feature; per-property comms content; **new module 26 data-onboarding** (go-live import). Schema → **70 models / 27 modules** | docs/requirements-traceability.md, specs/26-data-onboarding |

## Open questions (need client/stakeholder input before their module is built)
- Aadhaar full-storage flag: on or off for go-live? (compliance)
- Which WhatsApp BSP, SMS provider, payment gateway will the client onboard? (integrations — affects only live activation, not the build)
- Channel manager: direct OTA certification vs aggregator? (13-booking-channel-integrations)
- Accounting target: Tally, Zoho Books, or both? (22-accounting-sync)
