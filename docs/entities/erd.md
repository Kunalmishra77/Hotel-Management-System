# Entity-Relationship Model

Visual companion to the canonical [`prisma/schema.prisma`](../../prisma/schema.prisma) (the source of truth). Shows the core relationships; the schema has the full field set and the [schema-deltas](../architecture/schema-deltas.md) list additive extensions per module.

## Core ERD

```mermaid
erDiagram
    Organization ||--o{ Property : owns
    Organization ||--o{ User : employs
    Organization ||--o{ Guest : has
    Property ||--o{ Floor : has
    Property ||--o{ RoomCategory : defines
    Property ||--o{ Room : contains
    RoomCategory ||--o{ Room : classifies
    RoomCategory ||--o{ RatePlan : priced_by
    RoomCategory ||--o{ DynamicRate : priced_by

    Guest ||--o{ Reservation : books
    Guest ||--o{ GuestId : identified_by
    Guest ||--|| GuestStatsSnapshot : summarized_by
    Corporate ||--o{ Reservation : attributed
    TravelAgent ||--o{ Reservation : attributed

    Property ||--o{ Reservation : at
    Reservation ||--o{ RoomAllocation : allocates
    Room ||--o{ RoomAllocation : allocated
    Reservation ||--|| Folio : has

    Folio ||--o{ FolioLine : contains
    Folio ||--o{ Payment : settled_by
    Folio ||--o{ Invoice : billed_by
    Property ||--o{ InvoiceSeries : numbers

    Property ||--o{ Expense : incurs
    Property ||--o{ Staff : employs
    Staff ||--o{ Attendance : records
    PayrollRun ||--o{ PayrollLine : contains
    Staff ||--o{ PayrollLine : paid_by

    Property ||--o{ HousekeepingTask : cleans
    Property ||--o{ MaintenanceJob : maintains
    Property ||--o{ DailyStatSnapshot : snapshots

    Guest ||--o{ Feedback : gives
    Guest ||--o{ MessageLog : receives
    Organization ||--o{ MessageTemplate : defines

    PosOrder ||--o{ PosOrderItem : has
    InventoryItem ||--o{ InventoryMovement : tracks
    ChannelAccount ||--o{ RoomTypeMapping : maps
```

## Entity ownership (which module writes which table)
| Owning module | Tables |
|---|---|
| 00-platform | Organization, User, RoleAssignment, PermissionOverride, AuditLog, DomainEvent, IntegrationInbox |
| 01-property | Property, Floor |
| 02-room-inventory | RoomCategory, Room |
| 03-reservations | Reservation, RoomAllocation |
| 04-guest-crm | Guest, GuestId |
| 05-guest-history | GuestStatsSnapshot |
| 06-billing | Folio, FolioLine, Payment, InvoiceSeries, Invoice |
| 07-expenses | Expense |
| 09-staff | Staff, Attendance |
| 21-payroll | PayrollRun, PayrollLine |
| 10 / 11 | HousekeepingTask / MaintenanceJob |
| 12-comms | MessageTemplate, MessageLog, Feedback |
| 13-channels | ChannelAccount, RoomTypeMapping |
| 14-analytics | DailyStatSnapshot, NightAuditRun |
| 19 / 20 | PosOrder, PosOrderItem / InventoryItem, InventoryMovement |
| 24 / 25 | DynamicRate, RatePlan / Corporate, TravelAgent |

## Invariants encoded in the schema
- **No overbooking**: `RoomAllocation` gets a PostgreSQL `EXCLUDE` constraint on `(roomId, daterange)` (03).
- **Gap-free invoices**: `InvoiceSeries.nextNumber` consumed under row lock; `Invoice(propertyId, number)` unique (06).
- **Append-only money**: `FolioLine`/`Payment`/`Invoice` insert-only; corrections are reversing rows (06).
- **Money = paise** (`Int`/`BigInt`); **time** = UTC instants + property-local `@db.Date`.
- **Tenancy**: every operational table carries `propertyId`; queries scoped via `db.scoped(user)`.
