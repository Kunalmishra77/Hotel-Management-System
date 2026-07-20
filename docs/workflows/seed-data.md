# Seed & Demo Dataset

The deterministic dataset for dev, tests, and demos — so the app is usable the moment it starts, and every test shares stable fixtures. Runs via `npm run db:seed` → `prisma/seed/index.ts`. Deterministic (fixed ids, injected clock) so tests referencing these ids are stable.

## Demo organization
- **Organization**: "Woodpecker Group"
- **Properties**: `WMG` "Woodpecker MG Road" (Karnataka, GSTIN) · `WWF` "Woodpecker Whitefield"
- **Timezone**: Asia/Kolkata; `currentBusinessDate` set to the seed date.

## Master data (per property)
- **Floors**: Ground, 1, 2.
- **Room categories**: Deluxe (₹4,000, HSN 996311, GST 12%, floor/ceil 3,000/8,000), Suite (₹7,000).
- **Rooms**: ~10–20 per property across categories/floors; one seeded `UNDER_MAINTENANCE` with a RoomBlock; statuses spread (vacant/occupied/reserved) to make the dashboard non-empty.
- **Rate plans** + a couple of approved `DynamicRate` rows for peak dates.

## Users (one per role, for RBAC tests)
Administrator (org-wide) · Manager@WMG · Reception@WMG · Accounts@WMG+WWF (2FA enabled) · Housekeeping@WMG · Maintenance@WMG. Known passwords (dev only).

## Guests & bookings
- ~10 guests incl. a Bangalore repeat guest, a corporate guest (ACME), one with masked Aadhaar + a passport.
- **Reservations** across states: a few `CONFIRMED` (future), 2 `IN_HOUSE` (with open folios + some charges), a couple `CHECKED_OUT` (with issued GST invoices), one `CANCELLED`, one `NO_SHOW`, one OTA-sourced (`BOOKING_COM` + channelRef), one WEBSITE booking.
- Matching **folios** with room/F&B/laundry lines, split payments, one generated **Invoice** (gap-free number), one advance.

## Operations
- Staff (~5) with a month of attendance incl. overtime → enough for a payroll DRAFT run.
- A few expenses across heads (approved + pending). A housekeeping task and a maintenance job (one preventive). Some POS menu items + one settled order. Inventory items incl. one below reorder level. A corporate account with a receivable and a negotiated rate. A travel agent with commission.
- Message templates for the key automations; sandbox `MessagingAccount`; a couple of `MessageLog` rows.

## Scale seed (separate, opt-in for NFR tests)
`npm run db:seed -- --scale` generates **100k+ guests, 50k reservations, 1M+ folio lines** to validate search p95 < 500ms and report budgets. Not run by default.

## Rules
- Fixed cuids/known references so specs' `Test Fixtures` tables (in each `user-stories.md`) resolve to real seeded rows.
- Idempotent: re-running the seed resets to the same state.
- Never seed real PII or real secrets. Dev passwords are obviously-fake.
