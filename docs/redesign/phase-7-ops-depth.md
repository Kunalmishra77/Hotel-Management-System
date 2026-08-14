# Phase 7 — Housekeeping & maintenance depth

> Part of the customer-first redesign. Two operational gaps that hotels feel daily:
> nowhere to log a guest's forgotten charger, and no vendor/cost trail on a repair.
> Phase 7 adds **Lost & Found** and **maintenance vendor + cost tracking** — both
> additive, both leaning on the modules already there.

## What already exists (reused)

- Housekeeping (10): tasks, linen, complaints, mobile board. Maintenance (11):
  `MaintenanceJob` with a status lifecycle, `costPaise` **already captured on
  close**, preventive schedule, room blocks. Phase 7 fills the two named gaps.

## Part A — Lost & Found (housekeeping depth)

**New `LostAndFoundItem`** — `orgId`, `propertyId`, `roomId?`, `description`,
`foundOn` (date), `foundByStaffId?`, `status` (STORED → CLAIMED / DISPOSED),
`claimantName?`, `resolvedOn?`, `notes?`. A short workflow: log a found item →
it's STORED → mark CLAIMED (who collected it) or DISPOSED. Gated `housekeeping:update`,
property-scoped, audited. A `/lost-found` page + nav item.

## Part B — Maintenance vendor + cost tracking

- Add `vendor String?` to `MaintenanceJob`; `closeJob` records it alongside the
  existing `costPaise` (the work-order trail: who did it, what it cost).
- `maintenanceOverview` gains `costThisMonthPaise` (Σ closed-job cost this month);
  surface it as a **spend** KPI on the maintenance page, and show the vendor in the
  job list.

## Tasks

- [ ] **T-1** — `LostAndFoundItem` model + `MaintenanceJob.vendor` + additive migration.
- [ ] **T-2** — Lost & Found feature: pure status helpers (unit-tested), actions
  (`logLostItem`, `resolveLostItem` → CLAIMED/DISPOSED), queries (`listLostAndFound`,
  scoped) — validate → authorize `housekeeping:update` → txn → audit → Result.
- [ ] **T-3** — `/lost-found` page (list + log form + resolve controls) + nav item.
- [ ] **T-4** — `closeJob` records `vendor`; `maintenanceOverview.costThisMonthPaise`;
  maintenance page spend KPI + vendor column.
- [ ] **T-5** — Unit (status helpers) + integration (log/claim scoped + RBAC deny;
  close records vendor+cost; cost rollup) + typecheck + lint + build; local-DB run.

## Security / DoD
- Both features authorize server-side (`housekeeping:update` / `maintenance:manage`),
  property-scoped, audited. Lost & Found carries no guest PII beyond a free-text
  claimant name the staff type.

## Out of scope (later)
- Housekeeping cleaning **checklists** + supervisor **inspection** step (touches the
  offline-sync'd status machine — deferred to avoid destabilising it). Vendor master
  list / PO integration (free-text vendor for now).
