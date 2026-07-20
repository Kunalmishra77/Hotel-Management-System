# 09 · Staff Management — Design

## Schema slice (from canonical `prisma/schema.prisma`)
Owns `Staff` (masked `aadhaarMasked`/`panMasked`, encrypted `bankAccount`), `Attendance` (unique `(staffId, day)`). **Schema notes:** `Attendance.leaveType` (`LeaveType` enum) and `StaffDocument(staffId, type, objectKey)` are **confirmed present in canonical schema**; `Staff.department` is free-text `String` (enum optional).

## Domain layer (pure) — `features/staff/domain/`
- `workedMinutes(checkInAt, checkOutAt, tz): number` (FR-4).
- `monthlySummary(attendance[], month, staff): { employedDays, workedDays, leaveDays, otMinutes }` (FR-6) — for 08/14 context; its `employedDays` is non-authoritative (21 owns the pay-basis `employedDays`).
- `maskId(value)` for Aadhaar/PAN.

## Application — server actions (`features/staff/actions.ts`)
Per `api-conventions.md`; `staff:manage`.
- `createStaff/updateStaff/deactivateStaff` — mask IDs, encrypt bank; events + audit. (FR-1/2/9)
- `recordAttendance(staffId, day, {checkInAt, checkOutAt, isLeave, leaveType, overtimeMinutes})` — validate, compute worked minutes, upsert per day. (FR-3/4/5)
- Query `attendanceSummary(propertyId, month)` — headcount/cost context for 08/14. (FR-6)
- Query `getStaffForPayroll(propertyId, month): StaffWithAttendance[]` — salary + `joinedOn`/`leftOn`/`isActive` + **raw per-day attendance** (incl. `leaveType`) for eligible staff; the read 21 consumes to derive `employedDays`/`lopDays`/`paidDays`. No bank/PII in the payload. (FR-10)

## UI — wireframes (mobile-first, `features/staff/components/`)
```
┌───────────────────────────┐
│ Staff · MG Road   [+ New] │
│ Anu K · Housekeeping      │
│  📞 98xxxx  ·  ₹31,000    │
│  Aadhaar XXXX XXXX 9012   │
│ [Attendance]              │
│ ── Today ──               │
│  Anu  in 09:00 out 17:30  │
│  [Mark leave][+OT]        │
└───────────────────────────┘
```
Attendance day view = quick check-in/out toggles per staff; masked PII with reason-gated reveal.

## Events
Emits: `StaffCreated`, `StaffUpdated`, `AttendanceRecorded`. Consumed by 21 (via query, not event, for computation). Catalog: `docs/architecture/domain-events.md`.

## Error catalog
`VALIDATION_FAILED`, `ATTENDANCE_DUPLICATE`, `FORBIDDEN`.

## Edge cases
- Overnight shift (out next day) → worked minutes across midnight via tz.
- Deactivated staff excluded from payroll (feeds 21 FR-11).
- PII never in logs; masked in lists/exports (compliance).
