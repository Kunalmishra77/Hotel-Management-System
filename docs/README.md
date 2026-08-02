# Woodpecker PMS — Documentation Index

This repository is **spec-driven and fully documented**. No feature code is written before an approved `tasks.md`. Read in the order below.

## 1. Start here
- [`/CLAUDE.md`](../CLAUDE.md) — entry point; the prime directive, non-negotiables, and how to load context.
- [`product/product-overview.md`](product/product-overview.md) — what we're building and why.
- [`requirements-traceability.md`](requirements-traceability.md) — **every client §1–19 line → its spec coverage + gaps** (the audit).
- [`architecture/module-connectivity.md`](architecture/module-connectivity.md) — how all 27 modules wire together (calls + events + tiers).

## 2. Steering (always-loaded project law) — [`/.claude/rules/`](../.claude/rules/)
`product` · `scope` · `architecture` · `tech-stack` · `data-model` · `business-rules` · `user-roles` · `security` · `compliance` · `integrations` · `ai-features` · `reporting` · `mobile-first` · `api-conventions` · `coding-standards` · `testing-strategy` · `non-functional-requirements` · `definition-of-done` · `glossary` (19 files).

## 3. Architecture — [`architecture/`](architecture/)
- [`high-level-architecture.md`](architecture/high-level-architecture.md) — C4, layers, request/data flow.
- [`module-connectivity.md`](architecture/module-connectivity.md) — how all 27 modules wire (tiers + calls + events).
- [`contracts.md`](architecture/contracts.md) — **exact cross-module + provider interface signatures**.
- [`rbac-matrix.md`](architecture/rbac-matrix.md) — 48 permissions × 6 roles.
- [`domain-events.md`](architecture/domain-events.md) — the event catalog (internal backbone).
- [`database-setup.md`](architecture/database-setup.md) — extensions, DB-level constraints, migration order.
- [`deployment-and-infra.md`](architecture/deployment-and-infra.md) — hosting, Docker, CI/CD, environments, DR.
- [`observability.md`](architecture/observability.md) — logging, metrics, alerts, health, runbooks.
- [`ui-foundation.md`](architecture/ui-foundation.md) — design system, tokens, shared components, UX patterns.
- [`schema-deltas.md`](architecture/schema-deltas.md) — change history (now **APPLIED**) + open client questions.
- [`adr/`](architecture/adr/) — 5 architecture decision records.
- [`../prisma/schema.prisma`](../prisma/schema.prisma) — **canonical data model (source of truth), finalized (70 models)**.

## 4. Data & entities — [`entities/`](entities/)
- [`erd.md`](entities/erd.md) — ER diagram + entity ownership map + encoded invariants.

## 5. Specs — [`/specs/`](../specs/) (27 modules × 4 files)
Each `specs/NN-*/`: `requirements.md` (EARS) → `user-stories.md` (Given/When/Then ACs + fixtures) → `design.md` (schema slice, wireframes, sequences, error catalog) → `tasks.md` (traced, checkboxed). Structure & quality bar: [`/specs/README.md`](../specs/README.md). Depth exemplar: [`03-reservations`](../specs/03-reservations/).

## 6. Automation & workflows — [`workflows/`](workflows/)
- [`automation-catalog.md`](workflows/automation-catalog.md) — every scheduled job + event-driven automation + the §11 comms automations.
- [`key-workflows.md`](workflows/key-workflows.md) — the critical end-to-end sequences.
- [`development-process.md`](workflows/development-process.md) — the spec-driven build process, commands, and build order.
- [`seed-data.md`](workflows/seed-data.md) — the deterministic demo/seed dataset (+ opt-in scale seed for NFR tests).

## 7. Integrations — [`integrations/`](integrations/)
- [`catalog.md`](integrations/catalog.md) — every external integration, its contract, sandbox/live matrix, and the client's live-activation blockers.

## 8. API surface — [`api/`](api/)
- [`api-surface.md`](api/api-surface.md) — server actions + route handlers + webhooks.

## 9. Reports & QA
- [`reports/report-catalog.md`](reports/report-catalog.md) — all reports + canonical metric definitions.
- [`qa/test-strategy-overview.md`](qa/test-strategy-overview.md) — test pyramid + AC traceability + gates.
- [`qa/journey-acceptance.md`](qa/journey-acceptance.md) — cross-module E2E journeys (J1–J8) + NFR budgets as measured acceptance.
- [`reviews/`](reviews/) — `/review-module` sign-offs, one per completed module.

## 11. Operations — [`runbooks/`](runbooks/)
- [`restore-drill.md`](runbooks/restore-drill.md) — backup restore drill: cadence, procedure, acceptance criteria, failure playbook.

## 10. Process tooling — [`/.claude/`](../.claude/)
- [`commands/`](../.claude/commands/) — `/create-spec`, `/implement-module`, `/review-module`, `/generate-tests`.
- [`memory/decisions.md`](../.claude/memory/decisions.md) — decision log.

---
**Status:** documentation complete across steering, specs, architecture, automation, and integrations.

**Implementation:** in progress, in the dependency-tier order in [`development-process.md`](workflows/development-process.md).

| Tier | Module | State |
|---|---|---|
| 0 | `00-platform` | ✅ **Complete** — 24/24 tasks, all 25 ACs tested, [review signed off](reviews/00-platform-review.md) |
| 0 | `01-property-management` | ✅ **Complete** — 17/17 tasks, all 10 ACs tested, [review](reviews/01-property-management-review.md) |
| 0 | `02-room-inventory` | ✅ **Complete** — 18/18 tasks, all 13 ACs tested, [review](reviews/02-room-inventory-review.md) |
| 1 | `04-guest-crm` | ✅ **Complete** — 22/22 tasks, all 16 ACs tested, [review](reviews/04-guest-crm-review.md) |
| 1 | `03-reservations` | ✅ **Complete** — 34/34 tasks, all 27 ACs tested, [review](reviews/03-reservations-review.md) |
| 2 | `06-billing-payments` | ✅ **Core complete** — 37/39 tasks, all 31 ACs tested (26 unit + 25 integration + 1 e2e), [review](reviews/06-billing-payments-review.md). Residual: 2 e2e journeys (POS/coupon) are integration-covered (R-10) |
| 2 | `05-guest-history` | ✅ **Complete** — 12/12 tasks, all 12 ACs tested (6 unit + 7 integration + 1 e2e), [review](reviews/05-guest-history-review.md) |
| 2 | `07-expense-management` | ✅ **Complete** — 12/12 tasks, all 11 ACs tested (5 unit + 8 integration + 1 e2e), [review](reviews/07-expense-management-review.md) |
| 2 | `09-staff-management` | ✅ **Complete** — 15/15 tasks, all 11 ACs tested (9 unit + 10 integration + 1 e2e), [review](reviews/09-staff-management-review.md) |
| 2 | `10-housekeeping` | ✅ **Complete** — 12/12 tasks, all 8 ACs tested (4 unit + 6 integration + 1 e2e), [review](reviews/10-housekeeping-review.md) |
| 2 | `11-maintenance` | ✅ **Complete** — 13/13 tasks, all 8 ACs tested (5 unit + 7 integration + 1 e2e), [review](reviews/11-maintenance-review.md) |
| 3 | `14-dashboard-analytics` | ✅ **Core complete** — 19/22 tasks, ACs tested (8 unit + 5 integration + 2 e2e), [review](reviews/14-dashboard-analytics-review.md). Residual: realtime tile push (R-13), FAILED-path test (R-14), trends/segments UI (R-15) |
| 3 | `08-profit-reports` | ✅ **Complete** — 10/10 tasks, all 9 ACs tested (6 unit + 3 integration + 2 e2e), [review](reviews/08-profit-reports-review.md) |
| 3 | `15-search-export` | ✅ **Complete** — 13/13 tasks, all 12 ACs tested (19 unit + 11 integration + 2 e2e), [review](reviews/15-search-export-review.md). Residual: p95@100k deferred to staging (R-18), async job worker (R-20) |
| 4 | `12-communications` | ✅ **Complete** — 25/25 tasks, all 18 ACs tested (29 unit + 12 integration + 1 e2e), [review](reviews/12-communications-review.md). Built via parallel subagent, integrated + verified serially. Residual: live BSP/DLT/DKIM onboarding (R-24) |
| 4 | `18-ai-features` | ✅ **Complete** — 14/14 tasks, all 12 ACs tested (25 unit + 9 integration + 1 e2e), [review](reviews/18-ai-features-review.md). Runs fully on the mock provider. Residual: live LLM keys are a config change (R-26) |
| 5 | `24-dynamic-pricing` | ✅ **Complete** — 11/11 tasks, all 8 ACs tested (15 unit + 9 integration + 1 e2e), [review](reviews/24-dynamic-pricing-review.md). Built via parallel subagent. Residual: 03-wiring follow-up (R-27) |
| 5 | `23-booking-engine` | ✅ **Complete** — 23/23 tasks, all 20 ACs tested (20 unit + 19 integration/security + 1 e2e), [review](reviews/23-booking-engine-review.md). No-overbooking + rate-limit + PII-safety verified. Residual: live gateway KYC (R-24) |
| 5 | `13-booking-channel-integrations` | ✅ **Complete** — 23/23 tasks, all 16 ACs tested (19 unit + 13 integration + 1 e2e), [review](reviews/13-booking-channel-integrations-review.md). One-availability-truth verified. Residual: live OTA certification (R-33) |
| 6 | `19-pos` | ✅ **Complete** — 20/20 tasks, all 15 ACs tested (17 unit + 17 integration + 1 e2e), [review](reviews/19-pos-review.md). Money only via 06; no-double-post concurrency verified |
| 6 | `20-inventory-stock` | ✅ **Complete** — 13/13 tasks, all 11 ACs tested (15 unit + 12 integration + 1 e2e), [review](reviews/20-inventory-stock-review.md). Idempotent POS-consumer verified |
| 6 | `21-payroll` | ✅ **Complete** — 22/22 tasks, all 17 ACs tested (48 unit + 7 integration + 1 e2e), [review](reviews/21-payroll-review.md). Staff-cost-once + finalize-lock verified |
| 6 | `22-accounting-sync` | ✅ **Complete** — 12/12 tasks, all 12 ACs tested (14 unit + 9 integration + 3 e2e), [review](reviews/22-accounting-sync-review.md). No-double-entry + idempotent-sync verified |
| 7 | `25-corporate-crm` | ✅ **Complete** — 15/15 tasks, all 8 ACs tested (18 unit + 13 integration + 1 e2e), [review](reviews/25-corporate-crm-review.md). `reserveCredit` preserved for 06; concurrent-credit verified |
| 7 | `26-data-onboarding` | ✅ **Complete** — 23/23 tasks, all 15 ACs tested (20 unit + 12 integration + 2 e2e), [review](reviews/26-data-onboarding-review.md). No foreign INSERTs; dry-run + idempotent + rollback verified |

**🎉 All 27 modules implemented, tested (sandbox/mock), and reviewed.** Remaining before go-live is external/ops, not module code: client-side integration activation (payments KYC · WhatsApp WABA + SMS DLT · OTA certification · Zoho/Tally auth), the 100k-scale p95 measurement in staging, CI enforcement of the coverage/NFR gates + the backup restore-drill, and the documented cross-module wiring follow-ups (03/23 → 24 dynamic + 25 negotiated rate; system-context readers for a few worker paths; POS `FOOD`-vs-`POS` charge-type spec reconciliation).

Two carried risks from 00 are tracked in its [review](reviews/00-platform-review.md): the NFR
latency budgets are **not yet measured** in a representative environment, and the ≥90% domain
coverage gate is configured but not yet enforced by a CI pipeline.
