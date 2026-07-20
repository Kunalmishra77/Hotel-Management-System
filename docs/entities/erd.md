# Entity-Relationship Model

Visual companion to the canonical [`prisma/schema.prisma`](../../prisma/schema.prisma) (the source of truth, **finalized — 66 models, all deltas applied**). The mermaid diagram below shows the **core** relationships (not every table); the ownership table further down lists **all 66 models** by owning module.

## Core ERD (key relationships)

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

## Entity ownership (all 66 models, by owning module)
| Owning module | Tables |
|---|---|
| 00-platform | Organization, User, RoleAssignment, PermissionOverride, PasswordResetToken, Session, SecuritySettings, AuditLog, DomainEvent, IntegrationInbox, BackupRun |
| 01-property | Property, Floor |
| 02-room-inventory | RoomCategory, Room, RoomBlock |
| 03-reservations | Reservation, RoomAllocation |
| 04-guest-crm | Guest, GuestId |
| 05-guest-history | GuestStatsSnapshot |
| 06-billing | Folio, FolioLine, Payment, InvoiceSeries, Invoice, Coupon, CouponRedemption |
| 07-expenses | Expense |
| 09-staff | Staff, Attendance, StaffAdvance, StaffDocument |
| 21-payroll | PayrollRun, PayrollLine |
| 10 / 11 | HousekeepingTask / MaintenanceJob |
| 12-comms | MessageTemplate, MessageAutomation, Campaign, CommunicationConsent, MessagingAccount, MessageLog, Feedback |
| 13-channels | ChannelAccount, RoomTypeMapping, ChannelSyncLog |
| 14-analytics | DailyStatSnapshot, NightAuditRun |
| 15-search-export | ExportJob |
| 18-ai | AiInteractionLog, GuestSegment |
| 19-pos | PosOutlet, MenuItem, PosOrder, PosOrderItem |
| 20-inventory | InventoryItem, InventoryMovement, RecipeComponent |
| 22-accounting-sync | AccountingConfig, AccountingSyncLog |
| 23-booking-engine | BookingEngineConfig, BookingEngineOrder |
| 24-dynamic-pricing | RatePlan, DynamicRate |
| 25-corporate-crm | Corporate, TravelAgent, NegotiatedRate |
| 26-data-onboarding | ImportBatch, ImportRow |

(16-access-control and 17-mobile own no tables — they operate on 00's models / are client-side. Total = 70.)

## Invariants encoded in the schema
- **No overbooking**: `RoomAllocation` gets a PostgreSQL `EXCLUDE` constraint on `(roomId, daterange)` (03).
- **Gap-free invoices**: `InvoiceSeries.nextNumber` consumed under row lock; `Invoice(propertyId, number)` unique (06).
- **Append-only money**: `FolioLine`/`Payment`/`Invoice` insert-only; corrections are reversing rows (06).
- **Money = paise** (`Int`/`BigInt`); **time** = UTC instants + property-local `@db.Date`.
- **Tenancy**: every operational table carries `propertyId`; queries scoped via `db.scoped(user)`.
