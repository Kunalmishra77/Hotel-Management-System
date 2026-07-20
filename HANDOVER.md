# Handover — Woodpecker PMS

**To:** the full-stack developer · **From:** the principal architect · **Status:** documentation complete, independently reviewed, schema-validated. **No application code written yet — that's your build.**

## What this is
A complete, spec-driven definition of a Property Management System for Woodpecker Apartments & Suites — 27 modules covering the client's full §1–19 requirement doc. Every module is specified to the field level; the database is finalized and **`prisma validate` passes**; every module-to-module seam has a contract.

## What's been done (so you can trust it)
- **27 modules** each fully specified: `requirements` (EARS) → `user-stories` (testable acceptance criteria + fixtures) → `design` (schema slice, wireframes, sequences, error catalog) → `tasks` (traced, checkboxed).
- **Finalized 70-model Prisma schema** — validated (`npx prisma validate` 🚀).
- **Independent adversarial review**: 5 reviewers found **92 defects (7 blockers, 41 major, 44 minor)** — all fixed and re-verified. Audit trail: [`docs/handover-review-findings.md`](docs/handover-review-findings.md).
- Traceability, module-connectivity, contracts, event catalog, RBAC matrix, automation catalog, deployment/CI-CD, observability, UI foundation, seed plan — all written.

## Start here (read in this order)
1. [`docs/README.md`](docs/README.md) — the documentation index.
2. [`CLAUDE.md`](CLAUDE.md) — the prime directive + non-negotiables + how to load context per task.
3. [`docs/architecture/high-level-architecture.md`](docs/architecture/high-level-architecture.md) + [`module-connectivity.md`](docs/architecture/module-connectivity.md) + [`contracts.md`](docs/architecture/contracts.md).
4. [`prisma/schema.prisma`](prisma/schema.prisma) — the data model (source of truth).

## First commands
```bash
cp .env.example .env.local          # fill what you have; the rest runs in sandbox/mock
npm install
npx prisma validate                 # already green
npx prisma migrate dev              # applies migrations incl. the raw-SQL constraints in docs/architecture/database-setup.md
npm run db:seed                     # deterministic demo data (docs/workflows/seed-data.md)
npm run dev                         # app   ·   npm run worker  (pg-boss jobs)
```

## How to build it
- **Order:** dependency tiers in [`.claude/rules/architecture.md`](.claude/rules/architecture.md) — Tier 0 (`00-platform` → `02`) first, through Tier 7 (`25`). See [`docs/workflows/development-process.md`](docs/workflows/development-process.md).
- **Per module:** each `tasks.md` T-1 folds that module's schema slice + migration (all deltas already in the canonical schema — see [`docs/architecture/database-setup.md`](docs/architecture/database-setup.md) for the DB-level constraints). Then **test-first** down `tasks.md`; check a box only when it meets [`.claude/rules/definition-of-done.md`](.claude/rules/definition-of-done.md).
- **Commands:** `/create-spec`, `/implement-module`, `/review-module`, `/generate-tests` in [`.claude/commands/`](.claude/commands/).

## Non-negotiables (they're in every spec — honor them)
Money = integer **paise** (BigInt on accumulating totals) + Decimal.js · **server-side authz** on every mutation, property-scoped · every mutation emits a **domain event + audit** · availability enforced in a transaction (no overbooking) · GST place-of-supply = property location for on-premise supplies · PII masked/encrypted per [`compliance.md`](.claude/rules/compliance.md) · integrations run in **sandbox/mock** with no credentials.

## Not your problem to decide (client/business calls — build against the interfaces)
Documented in [`docs/architecture/schema-deltas.md`](docs/architecture/schema-deltas.md): Aadhaar full-storage legal sign-off · live provider choices (WhatsApp BSP / SMS DLT / payment gateway / Tally-vs-Zoho) · OTA certification vs aggregator. Everything is built provider-abstracted; going live is a config change, never a code change.

You have everything you need. Build in tier order, test-first, and lean on the specs — they answer the "what" and "why"; you own the "how".
