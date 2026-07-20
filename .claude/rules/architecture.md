# Architecture

## Style
Modular monolith on Next.js (App Router). One deployable, hard module boundaries. Feature-colocated code, shared cross-cutting concerns in `src/lib`. Event-driven internally so comms/AI/analytics are decoupled from write paths.

## Layers (dependencies point downward only)

```
UI (app/, components/, features/*/components)
        │
Application (features/*/actions.ts — server actions, use-cases, orchestration)
        │
Domain (features/*/domain — pure business rules, invariants, calculations)
        │
Infrastructure (lib/db, lib/messaging, lib/payments, lib/ai, lib/integrations, lib/events)
        │
PostgreSQL / object storage / external providers
```

- **Domain is pure** — no I/O, no framework imports. Deterministic and unit-testable (folio math, GST, availability, RevPAR).
- **Application** orchestrates: validate → authorize → transaction → emit event → audit.
- **UI never calls infrastructure directly.** It calls server actions.

## Module dependency graph (this is the build order)

```
Tier 0  00-platform · 01-property-management · 02-room-inventory
Tier 1  04-guest-crm · 03-reservations
Tier 2  06-billing-payments · 05-guest-history · 07-expenses · 09-staff · 10-housekeeping · 11-maintenance
Tier 3  08-profit-reports · 14-dashboard-analytics · 15-search-export
Tier 4  12-communications · 18-ai-features
Tier 5  13-ota-channel · (payments live) · 23-booking-engine · 24-dynamic-pricing
Tier 6  19-pos · 20-inventory-stock · 21-payroll · 22-accounting-sync
Tier 7  25-corporate-crm
```
A module may depend only on lower/equal tiers. No upward or cyclic dependencies.

## Multi-property tenancy
- Single organization, **many properties** (and future branches). Not multi-tenant SaaS yet, but modelled so it can become one.
- Every operational entity carries `propertyId`. Every read/write is scoped to the properties the current user may access (`user-roles.md`).
- A shared `db.scoped(user)` helper injects the property filter; raw unscoped queries are prohibited outside admin/reporting rollups.

## Domain events (the internal backbone)
- Every state change emits an event (`ReservationCreated`, `FolioCharged`, `PaymentReceived`, `RoomStatusChanged`, `GuestCheckedOut`, …). Catalog: `docs/architecture/domain-events.md`.
- Events are persisted (outbox) then dispatched via `pg-boss`. Consumers: communications, AI, analytics, accounting-sync, webhooks.
- Benefit: adding a new automation never touches the write path.

## Folder map
```
src/
  app/          routes (route groups: (auth), (dashboard)); api/ for webhooks & non-form endpoints
  components/   shared presentational: ui, forms, tables, cards, charts, layout, mobile
  features/<m>/ actions.ts · domain/ · components/ · queries.ts · schema.ts (zod) · events.ts
  lib/          auth, db, permissions, audit, messaging, ai, payments, exports, integrations,
                events, validators, utils, constants
  hooks/ stores/ types/ styles/ middleware.ts
```

## Key rules
- A `features/` file that exceeds ~300 lines is a smell — split by responsibility.
- Cross-module calls go through the target module's `actions.ts`/`queries.ts`, never into its internals.
- Background work (reminders, OTA sync, forecasts, backups) runs as `pg-boss` jobs in `scripts/worker.ts`, not inside request handlers.
