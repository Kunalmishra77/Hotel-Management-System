# 01 · Property Management — Requirements

> Source: client doc §1. Read with `.claude/rules/architecture.md` (tenancy), `rules/reporting.md` (occupancy), `prisma/schema.prisma`. Matches the depth bar in `specs/03-reservations/`.

## Purpose & scope
Manage the properties the organization operates — the top of the tenancy tree — and present a real-time, multi-property occupancy overview. Every other module's data hangs off a `Property`.

**In scope:** property CRUD (name, code, address, GST, owner, timezone), floors, property activation, the multi-property dashboard entry showing live occupancy/status per property.
**Out of scope:** room categories & rooms & room status (02), the full analytics dashboard tiles (14), user↔property access assignment (16 — this module only reads scope).

## Dependencies
- **Tier 0:** 00-platform (org, auth, tenancy, events, audit).
- **Consumed by:** every operational module (all carry `propertyId`); 14-analytics (rollups), 16-access-control (property scope).

## Data owned
`Property`, `Floor`. Reads: `Room`/`RoomStatus` (owned by 02) for occupancy counts.

## Functional requirements (EARS)
- **FR-1 (ubiquitous):** The system shall let an Administrator create/edit a `Property` with name, unique `code` (used in invoice numbering), full address (line1/2, city, state, country, pincode), `timezone`, optional `gstin`, `ownerName`, `ownerContact`.
- **FR-2 (unwanted):** If a property `code` is not unique within the organization, then the system shall reject the save.
- **FR-3 (unwanted):** If a `gstin` is present but malformed (not a valid 15-char GSTIN pattern), then the system shall reject it with a field error.
- **FR-4 (ubiquitous):** The system shall manage `Floor`s per property (name + sort order), unique by name within the property.
- **FR-5 (state):** While a property is inactive (`isActive=false` / soft-deleted), the system shall exclude it from operational booking flows but retain it for historical reporting.
- **FR-6 (ubiquitous):** The system shall present a multi-property overview listing each property with live counts: total rooms, vacant, occupied, reserved, under-maintenance, housekeeping, and **live current-status occupancy %** = rooms currently `OCCUPIED` ÷ (total active rooms − `UNDER_MAINTENANCE`) (`rules/reporting.md`). This point-in-time status rollup is labelled as such and is **not** the ADR/RevPAR denominator (14's room-night occupancy over a date range); `RESERVED` rooms are not counted `OCCUPIED` here.
- **FR-7 (event):** When a room's status changes (event `RoomStatusChanged` from 02/10), the system shall update the property's live occupancy view within the realtime latency budget.
- **FR-8 (ubiquitous):** The system shall scope every property read/write to the properties the current user may access (`rules/user-roles.md`); Administrators see all in the org.
- **FR-9 (event):** When a property is created/updated/deactivated, the system shall emit `PropertyCreated`/`PropertyUpdated`/`PropertyDeactivated` respectively and write an audit record.
- **FR-10 (ubiquitous):** The system shall support many properties per organization and future branches without schema change (tenancy is data, not code).

## Non-functional (cited)
- Multi-property overview loads p95 < 1.5s for 10+ properties; live occupancy update latency < 2s (`rules/non-functional-requirements.md`).
- Mobile-first: the overview is usable one-handed on a phone.

## Business rules referenced
`business-rules.md` §20 (validate→authorize→transaction→event→audit); tenancy rule in `architecture.md` (every operational row carries `propertyId`, every query scoped).
