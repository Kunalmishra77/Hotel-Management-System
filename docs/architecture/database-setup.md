# Database Setup, Constraints & Migration Guide

Everything the developer needs to stand up and evolve the database correctly. Source of truth: [`prisma/schema.prisma`](../../prisma/schema.prisma) (66 models, 17 enums).

## Postgres version & extensions
- **PostgreSQL 14+** (18 available locally). Host in an **India region** (`ap-south-1`) for DPDP data residency.
- Required extensions (enable in the first migration):
  - **`btree_gist`** — for the no-overbooking exclusion constraint (03).
  - **`pg_trgm`** — for fast fuzzy guest/name search (04/15).
  - **`pgcrypto`** (optional) — if using DB-side hashing for search tokens.

## DB-level constraints (not expressible in Prisma — add via raw SQL in migrations)
| Constraint | Table | SQL (in migration) | Guards |
|---|---|---|---|
| **No overbooking** | RoomAllocation | `EXCLUDE USING gist ("roomId" WITH =, daterange("startDate","endDate",'[)') WITH &&)` | 03 FR-4 |
| **Gap-free invoice no.** | InvoiceSeries/Invoice | `SELECT … FOR UPDATE` on series in the invoice txn + `UNIQUE(propertyId, number)` | 06 FR-13 |
| **Append-only ledger** | FolioLine, Payment, Invoice, AuditLog, DomainEvent | trigger/role: `REVOKE UPDATE, DELETE` (corrections = reversing rows) | 06 FR-2 / 00 FR-16 |
| **Non-negative amounts** | FolioLine.quantity, Payment.amountPaise, etc. | `CHECK (amount_paise >= 0)` where applicable | validation |
| **Unique per-day attendance** | Attendance | `UNIQUE(staffId, day)` (Prisma) | 09 |
| **Fuzzy search index** | Guest | `CREATE INDEX … USING gin (full_name gin_trgm_ops)` | 04/15 p95<500ms |
| **Night-audit idempotency** | FolioLine | `CREATE UNIQUE INDEX … ON "FolioLine"("folioId","businessDate") WHERE type='ROOM'` | 06 FR-5 (no double room-night post) |
| **No booking over a block** | RoomBlock vs RoomAllocation | app-level: allocation tx also `SELECT … FOR UPDATE`/checks no overlapping `RoomBlock`; optional trigger to reject | 03 B1 / business-rules §2 |
| **POS-consumption idempotency** | InventoryMovement | `UNIQUE(refType, refId, itemId)` (in schema) | 20 FR-3 (redelivered event deducts once) |
| **Explicit onDelete** | financial/guest FKs | `Restrict` on Reservation→Guest, Folio→Reservation, FolioLine/Payment/Invoice→Folio, Staff/Expense→Property; `Cascade` only for owned child rows (PosOrderItem→PosOrder, PayrollLine→PayrollRun) | data-model.md |

**Availability = allocations + blocks:** `03.searchAvailability` and the allocation transaction must exclude rooms with an overlapping `RoomBlock` **and** an overlapping `RoomAllocation` (the exclusion constraint only covers allocations). Route date-ranged maintenance through `RoomBlock` (owned via `11.blockRoom`→`02`), and check both in the serializable booking tx.

## Migration order (mirrors the build tiers — [development-process.md](../workflows/development-process.md))
Each module's `tasks.md` **T-1** writes its migration. Apply in dependency order so foreign keys resolve:
```
00 (org/user/rbac/audit/events/backup + extensions)
→ 01 (property) → 02 (category/room/roomblock)
→ 04 (guest) → 03 (reservation/allocation + exclusion constraint)
→ 06 (folio/invoice + append-only) → 05,07,09,10,11
→ 14,15,16 → 12,18 → 13,23,24 → 19,20,21,22 → 25
```
Prisma commands: `npx prisma migrate dev --name <module>` per slice; `npx prisma migrate deploy` in prod.

## Money & time (encoded everywhere)
- Money: `Int`/`BigInt` **paise**; compute with Decimal.js; round half-up at line level.
- Time: `DateTime` = UTC instant; property-local calendar dates use `@db.Date` + `Property.timezone`; the business day is defined by night audit.

## Seeds
`npm run db:seed` runs `prisma/seed/index.ts` — see [seed-data.md](../workflows/seed-data.md) for the demo dataset (org, 2 properties, rooms, guests, sample reservations/folios, users per role).

## Verification checklist (developer's first setup)
```bash
npm install
npx prisma validate          # schema compiles
npx prisma migrate dev       # applies migrations incl. raw-SQL constraints
npx prisma db seed           # demo data
npm run typecheck && npm test
```
