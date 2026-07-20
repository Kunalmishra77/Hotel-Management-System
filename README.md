# Woodpecker PMS

A Property Management System for **Woodpecker Apartments & Suites Pvt. Ltd.** — multi-property operations, reservations, guest CRM, GST billing, expenses, staff, housekeeping, maintenance, analytics, guest communication (WhatsApp/Email/SMS), AI, and OTA/channel + accounting/POS/inventory/payroll integrations.

Mobile-first PWA. Built with Next.js + React + TypeScript + PostgreSQL/Prisma.

## This repository is spec-driven

**Nothing is implemented until it is specified.** Read in this order:

1. **`CLAUDE.md`** — how to work in this repo (entry point for any agent/dev).
2. **`.claude/rules/`** — steering: always-true, project-wide rules (product, scope, architecture, stack, business rules, roles, security, compliance, NFRs, standards).
3. **`docs/architecture/`** — high-level architecture, ERD, RBAC matrix, ADRs, domain events.
4. **`specs/NN-module/`** — per-module `requirements.md` → `user-stories.md` → `design.md` → `tasks.md`.
5. **`prisma/schema.prisma`** — the canonical data model (single source of truth for entities).

## Module map (build/dependency order)

Tier 0 foundation → Tier 7. See `.claude/rules/architecture.md` and `docs/architecture/high-level-architecture.md`.

## Getting started (developer)

```bash
cp .env.example .env.local        # fill in what you have; rest falls back to sandbox/mock
npm install
npm run db:migrate
npm run db:seed
npm run dev
```

## Status

Pre-implementation. Specs are being authored. Do not write feature code ahead of an approved `tasks.md`.
