# /review-module — 09-staff-management

**Date:** 2026-08-02 · **Reviewer:** implementing engineer (self-review, per DoD § Review)
**Depends on:** Tier 0/1 ✅ · encryption/masking (00) ✅
**Tier 2.** Feeds 21-payroll (via `getStaffForPayroll`) and 08/14 (headcount/cost context).

Checklist source: [`.claude/commands/review-module.md`](../../.claude/commands/review-module.md)

---

## 1. Traceability — AC → test

**9 domain unit tests** + **10 integration tests** + **1 e2e**. Every AC maps to a test.

| AC | Requirement | Covered by |
|---|---|---|
| AC-1 | Create staff, Aadhaar/PAN masked, bank encrypted, `StaffCreated` + audit | `staff` (create) · e2e |
| AC-2 | Missing mobile / salary ≤ 0 rejected | `staff` (salary 0) · schema |
| AC-3 | Reception (no `staff:manage`) → FORBIDDEN | `staff` (Reception denied) |
| AC-4 | List masks Aadhaar/PAN/bank/mobile; name/dept visible | `staff` (list masked, no bank) · e2e |
| AC-5 | 09:00→17:30 = 510 worked minutes, unique `(staff,day)` | `domain` · `staff` (510) · e2e |
| AC-6 | Check-out before check-in rejected | `domain` · `staff` (VALIDATION_FAILED) |
| AC-7 | Leave → no worked minutes; 90 OT on another day persists | `staff` (leave + OT) |
| AC-8 | Second row for the same day rejected | `staff` (ATTENDANCE_DUPLICATE) |
| AC-9 | Monthly summary: employed/worked/leave days, OT | `domain` (monthlySummary) · `staff` (summary) |
| AC-10 | Deactivated staff excluded from payroll, history kept | `staff` (left-before-month excluded, June kept) |
| AC-11 | `getStaffForPayroll`: salary + window + raw attendance, NO PII | `staff` (feed, no masked-id/bank in payload) |

---

## 2. Invariants

| Invariant | Status |
|---|---|
| Staff PII protected | ✅ Aadhaar/PAN stored MASKED (never raw), bank ENCRYPTED (`v1.` envelope); lists mask mobile too; bank never returned (AC-1/4/11) |
| One attendance row per staff per day | ✅ DB unique `(staffId, day)` → `ATTENDANCE_DUPLICATE` (AC-8) |
| Worked minutes instant-based | ✅ overnight shift handled; check-out ≤ check-in rejected (AC-5/6) |
| Money in paise | ✅ `monthlySalaryPaise` integer |
| Payroll feed is authoritative-source, PII-free | ✅ raw per-day attendance so 21 derives paid/LOP/employed days itself; no bank/ID in payload (AC-11) |
| Deactivation retains history | ✅ `isActive=false`+`leftOn`; excluded from the month's feed only once the window no longer overlaps (AC-10) |
| Every mutation: event + audit | ✅ `StaffCreated`/`StaffUpdated`/`AttendanceRecorded` + audit |
| RBAC server-side | ✅ `staff:manage` (Admin/Manager), deny-by-default (AC-3) |

---

## Decisions

### D-1 · `recordAttendance` rejects a duplicate day rather than upserting
The design mentions "upsert per day", but AC-8 requires a second row to be *rejected*. The AC wins:
attendance is create-only, and a second entry for the same day returns `ATTENDANCE_DUPLICATE`
(DB unique constraint). Correcting a day would be an explicit update action — a follow-up (F-1).

### D-2 · `employedDays` here is non-authoritative
`monthlySummary.employedDays` is the employment-window∩month overlap, for 08/14 context. 21 owns the
pay-basis `employedDays` and derives it from the **raw per-day feed** `getStaffForPayroll` returns —
so the two never disagree by construction (21 doesn't read this summary for money).

---

## Findings

### F-1 · Non-blocking · No "edit a recorded day" path
Attendance is create-only (D-1). Fixing a mis-keyed day needs an explicit, audited update action.
**Action:** add `amendAttendance` when the front-desk correction flow is prioritised.

### F-2 · Non-blocking · Reveal-with-reason for staff PII not wired
The wireframe mentions reason-gated reveal of masked staff IDs. Aadhaar/PAN are stored masked (the
raw is never persisted), so there is nothing to reveal on the row today; a scan-view path (via
`StaffDocument` + object storage, like 04's ID scans) is the follow-up if full-value view is needed.

---

## Carried risks

- **R-1..R-11** from earlier modules — unchanged.
- No new module-specific risk: 09 is self-contained (one additive error code, otherwise new files).
