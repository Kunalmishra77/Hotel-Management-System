# 09 · Staff Management — Requirements

> Source: client doc §8. Read with `rules/compliance.md` (staff PII), `rules/data-model.md`, `prisma/schema.prisma`. Depth bar: `specs/03-reservations/*`.

## Purpose & scope
Own staff records and daily attendance per property, and expose the derived monthly attendance summary that payroll (21) computes from. This module is the sole writer of `Staff`/`Attendance`.

**In scope:** staff CRUD (name, contact, department, salary, joining date, masked Aadhaar/PAN, bank details); attendance capture (check-in/out, worked minutes, leave, overtime); monthly attendance summary query; masked PII handling.
**Out of scope:** salary computation & payslips (21 — reads this module), payroll disbursement/accounting (22), user login accounts (00 — staff ≠ system users unless separately given a `User`).

## Dependencies
- **Tier 0:** 00-platform (auth, tenancy, events, audit), 01-property-management.
- **Consumed by:** 21-payroll (Staff + Attendance), 08/14 (headcount/cost context).

## Data owned
`Staff`, `Attendance`. **Schema notes:** `Attendance.leaveType` (`LeaveType` enum NONE|CASUAL|SICK|PAID|UNPAID) and `StaffDocument(staffId, type, objectKey)` are **confirmed present in canonical schema**; `Staff.department` remains free-text `String` (an enum is optional, not required). Migration materializes the slice; nothing here is new.

## Functional requirements (EARS)
- **FR-1 (ubiquitous):** Maintain a `Staff` record per employee, property-scoped, with name, mobile, address, department, `monthlySalaryPaise`, `joinedOn`, masked Aadhaar/PAN, encrypted bank details; soft-deleted, never hard-deleted.
- **FR-2 (unwanted):** If mobile is missing/invalid or `monthlySalaryPaise` ≤ 0, reject at validation; nothing persists.
- **FR-3 (ubiquitous):** Record `Attendance` per staff per day (unique `(staffId, day)`) with `checkInAt`, `checkOutAt`, derived `workedMinutes`, `isLeave`, `overtimeMinutes`.
- **FR-4 (event):** When a check-in/out is recorded, compute `workedMinutes` from the timestamps in property-local time; a day may be marked leave (no worked minutes) or carry overtime.
- **FR-5 (unwanted):** If check-out precedes check-in, or overtime is negative, reject at validation.
- **FR-6 (ubiquitous):** Provide a monthly attendance summary per staff (employed days, worked days, leave days, total overtime minutes) for a `(property, month)` — **for 08/14 headcount/cost context, not the payroll pay-basis**. Its `employedDays` is a **non-authoritative** context figure computed with the **exact definition 21 owns** (calendar days employed in the month, from `max(monthStart, joinedOn)` to `min(monthEnd, leftOn ?? monthEnd)`) so the two never diverge; **21 is the single authority for `employedDays`** and derives it (and `lopDays`) itself from the raw records exposed by FR-10.
- **FR-7 (ubiquitous):** Expose bank details + masked Aadhaar/PAN only to authorized roles; mask by default in lists/exports (`compliance.md`).
- **FR-8 (ubiquitous):** Every staff/attendance mutation is property-scoped, authorized server-side (`staff:manage`), audited, and emits its domain event.
- **FR-9 (state):** While a staff member is inactive/deleted, exclude them from new attendance and from payroll eligibility, but retain history.
- **FR-10 (ubiquitous):** Expose `getStaffForPayroll(propertyId, month): StaffWithAttendance[]` (per `contracts.md`) — for each staff member employed in the month, their `monthlySalaryPaise`, `joinedOn`, `leftOn`, `isActive`, **plus the raw per-day `Attendance` rows** (`day`, `isLeave`, `leaveType`, `workedMinutes`, `overtimeMinutes`) — so **21 derives `lopDays`/`paidDays` and the pay basis itself** (21 owns `employedDays`; 09 supplies inputs, never the pay basis). This is the read 21 consumes on its write path (not `attendanceSummary`); bank/PII fields are not returned by this action.

## Field-staff location tracking (addendum 2026-08-09, MoM line 32)
Drivers / field agents are tracked while on-duty. Location is operational PII — manager-only, on-duty-only, consent-gated (`compliance.md`).
- **FR-16 (field flag):** A staff member can be marked `isFieldStaff`. Enabling tracking stamps a unique `trackingToken` (cleared on disable). Only field staff appear on the map / accept pings. `enableFieldTracking`/`disableFieldTracking` require `staff:manage`, are audited, and emit `FieldTrackingEnabled`/`FieldTrackingDisabled`.
- **FR-17 (capture, no login):** The driver opens a private tokened link `/track/[token]` on their phone. After an explicit **consent** notice, the browser Geolocation API POSTs a location ping every few minutes to a **public, rate-limited** endpoint (`recordFieldPing`) while the page stays open — closing it ends the on-duty session. The token is the credential; a token whose staff is not `isFieldStaff` (or was disabled) is rejected. No Google API key: capture is the browser, display is deep-links.
- **FR-18 (ping record):** Each ping stores `lat, lng, accuracyM?, capturedAt` against the staff + property. Pings are high-volume insert-only — no per-ping event/audit. Rate-limited per token (≈1 / 10s).
- **FR-19 (manager view):** `listFieldStaffLocations` (`staff:manage`) returns each field-staff's last-known ping with a **stale** flag (no ping within the freshness window, default 10 min) and an **"Open in Google Maps"** deep link (`maps.google.com/?q=lat,lng`). Manager-only; never exposed to other staff or guests.
- **FR-20 (retention/privacy):** Pings are retained for a bounded window (operational need) and are never shown outside the manager map. Disabling tracking clears the token so the link stops working.

## Non-functional (cited)
Staff list + attendance capture usable on a phone; common mutations p95 < 800ms; PII encrypted at rest; masked by default. (`non-functional-requirements.md`, `compliance.md`)

## Business rules referenced
`business-rules.md` §20 (validate→authorize→transaction→event→audit); `data-model.md` (PII masking/encryption, soft-delete, property-local dates).
