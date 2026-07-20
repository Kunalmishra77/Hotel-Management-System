# Data Model Rules

`prisma/schema.prisma` is the **single source of truth**. These rules govern how it is written and extended.

## Identity & tenancy
- Primary keys: `cuid()` strings (`id`).
- Every operational table has `propertyId` (FK) and is queried through the property-scoped helper.
- Timestamps: `createdAt` (default now), `updatedAt` (`@updatedAt`). Soft-delete via `deletedAt` on entities that must never be hard-deleted (guests, invoices, folio lines, audit).

## Money
- **Single currency: INR.** No per-row `currency` column — the whole system is INR paise. (If multi-currency is ever needed, that's a schema migration + an explicit ADR, not an assumed field.)
- Store money as integer **paise**. Use **`BigInt`** for anything that can accumulate large totals — folio-line/payment/invoice amounts, receivables, credit limits, snapshot totals; `Int` only for small bounded values (per-unit rates, tax components). Column names end in `...Paise` or carry a `// paise` comment.
- Never `Float`/`Decimal` columns for currency of record. Compute with Decimal.js, persist integers; round half-up at line level.

## Time
- All timestamps stored UTC (`DateTime`). Business/calendar dates that must be property-local (booking dates, business date, attendance day) use a `@db.Date` plus the property timezone for interpretation.
- Never compare a stored UTC instant to a local date without converting via the property timezone.

## Enums & status
- Use Prisma enums for closed sets (RoomStatus, ReservationStatus, PaymentMode, BookingSource, ExpenseHead, UserRole, etc.). Keep enum values aligned with `scope.md`/`business-rules.md`.

## Append-only / immutability
- Folio lines, payments, invoices, audit logs, domain events: **insert-only**. No updates that change financial meaning; corrections are new reversing rows.

## Relations & integrity
- Foreign keys explicit with sensible `onDelete` (mostly `Restrict` for financial/guest data; `Cascade` only for owned child rows).
- Add DB-level constraints for invariants where possible (unique invoice number per property/FY; exclusion constraint for room-date overlap; check constraints on non-negative amounts).

## PII
- PII columns (Aadhaar, passport, contact) are encrypted at rest (`compliance.md`). Aadhaar stored masked by default with full value only if the compliance flag permits; scans live in access-controlled object storage, DB holds a reference + checksum, not the bytes.

## Conventions
- Table = singular PascalCase model; fields camelCase. Join tables named `AOnB`.
- Index every FK and every column used in a hot filter/search (see `non-functional-requirements.md`).
- Each module "owns" its tables; cross-module reads go through that module's query layer, not foreign SELECTs sprinkled everywhere.
