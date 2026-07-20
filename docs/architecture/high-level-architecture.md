# High-Level Architecture

## Context (C4 level 1)
```
      Staff (phone/tablet/laptop)        Guests (booking engine, chatbot)
                 │                                  │
                 ▼                                  ▼
        ┌─────────────────────────────────────────────────┐
        │            Woodpecker PMS (Next.js PWA)          │
        │   UI · Server Actions · Route Handlers · Worker  │
        └─────────────────────────────────────────────────┘
             │            │             │            │
             ▼            ▼             ▼            ▼
        PostgreSQL   Object store   pg-boss jobs   External providers
        (Prisma)     (ID scans)     (async)        (payments, WhatsApp/SMS/email,
                                                    OTA/channel, accounting, LLM)
```

## Containers (C4 level 2)
- **Web app (Next.js)** — SSR/RSC UI + Server Actions (mutations) + Route Handlers (`/api`: webhooks, exports, SSE, booking-engine, AI).
- **Worker** (`scripts/worker.ts`) — pg-boss consumers: event dispatch, comms outbox, reminders, OTA sync, night audit, forecasts, backups.
- **PostgreSQL** — system of record (Prisma). **Object storage** — ID scans, invoice PDFs, images.
- **Provider adapters** — payments, messaging, channel manager, accounting, LLM — all behind interfaces (`lib/*`).

## Request → data flow (mutation)
```
UI action ─► Server Action
              1. zod validate
              2. authorize (permission + property scope)
              3. transaction (Prisma) — enforce invariants
              4. persist DomainEvent (outbox) + AuditLog
              5. return typed Result
Worker ◄── pg-boss ◄── outbox dispatch ─► consumers (comms / analytics / accounting / webhooks)
UI ◄── SSE (LISTEN/NOTIFY) ─── live occupancy / cross-device sync
```

## Why this shape
- **Modular monolith**: one deployable, hard module boundaries → fast to build, cheap to run, easy to reason about; can split a module into a service later if load demands (ADR-0001).
- **Event-driven core**: comms/AI/analytics are consumers, not tangled into write paths → new automations don't touch billing/reservations.
- **Provider abstraction**: the app runs fully in sandbox/mock; live is a config change (ADR-0003).
- **Token discipline for AI-assisted dev**: small always-loaded steering + on-demand specs + one canonical schema → every task has a small, exact context.

## Environments
- **dev**: local Postgres + MinIO + all providers mock/sandbox.
- **staging**: India-region managed Postgres + S3; sandbox provider creds.
- **prod**: India region; live creds added per-integration as the client completes onboarding.

## Cross-cutting
Auth/RBAC · audit · domain events/outbox+inbox · encryption/PII · realtime · jobs · i18n-ready copy. See the matching `.claude/rules/*` and ADRs.
