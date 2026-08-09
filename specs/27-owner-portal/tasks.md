# 27 · Owner Portal — Tasks

Ordered, small, test-first for domain. Each ends at `rules/definition-of-done.md`. `(AC-n)/(FR-n)` = traceability. Fixtures in `user-stories.md`.

## Phase 1 — Access & foundation
- [ ] T-1 Schema + migration: `OWNER` in `RoleName`; `Property.managementFeeBps`; `PropertyDocument`, `PropertyImportantDate`, `OwnerPayout` models + indexes + `OwnerPayout` unique `(propertyId, periodMonth)`. Reversible. (FR-1/6/9/12)
- [ ] T-2 Permissions: add `owner:view-financials|view-payout|view-schedule|view-docs|upload-docs` (OWNER) + `owner:manage` (ADMIN/MANAGER) + `owner:payout-manage` (ADMIN) to the permission map + rbac-matrix doc. (FR-2/3)
- [ ] T-3 Seed: `USER_OWNER_A` (PROP-A), `USER_OWNER_AB` (PROP-A+B), PROP-A `managementFeeBps=1500`, a couple of important dates. (fixtures)
- [ ] T-4 Nav: owner items (Owner home, Documents, Schedule, Payouts) gated on owner perms; confirm permission-filtered shell shows owner only their surfaces. (AC-1)

## Phase 2 — Financials
- [ ] T-5 `queries.ownerFinancials(user,{propertyId,from,to})` — authorize on `owner:view-financials` + scope; reach numbers via the reports/analytics **computation layer** (NOT a report action that requires `report:view-financial` — owners don't hold it); no recompute. Integration: equals reports figures (AC-4/5).
- [ ] T-6 `/owner` home: KPIs (revenue/expense/profit/occupancy) + revenue trend, mobile-first, date-range. (AC-4)

## Phase 3 — Document vault
- [ ] T-7 `actions.uploadOwnerDocument` (owner:upload-docs | owner:manage) → encrypted `put` + row + `PropertyDocumentUploaded` + audit. (FR-6/7, AC-6/7)
- [ ] T-8 `queries.listOwnerDocuments` (scoped, non-deleted) + `getOwnerDocumentBytes` (authorized) + `/owner/documents/[docId]` GET stream + access audit. (FR-7, AC-8)
- [ ] T-9 `actions.deleteOwnerDocument` — soft-delete; owner may delete own uploads only, staff (`owner:manage`) any; `PropertyDocumentDeleted` + audit. (FR-8, AC-9)
- [ ] T-10 `/owner/documents` UI: list + upload (owner) + download + delete-own. (AC-6/8/9)

## Phase 4 — Schedule
- [ ] T-11 `actions.createImportantDate` / `deleteImportantDate` (owner:manage) + `ImportantDateChanged` + audit. (FR-9, AC-12)
- [ ] T-12 `queries.ownerSchedule(user,propertyId)` — important dates (soonest-first, overdue flag) + upcoming preventive maintenance (reuse 11) + occupancy calendar (reuse 03), counts only. (FR-9/10, AC-10/11)
- [ ] T-13 `/owner/schedule` UI + manage-dates widget on `/properties/[id]`. (AC-10/11/12)

## Phase 5 — Payout (money)
- [ ] T-14 Domain `computePayout(revenuePaise,expensePaise,feeBps)` (Decimal, round half-up, negative net allowed) — unit tests incl. AC-13 (₹2,45,000) + AC-14 loss month + zero fee. (FR-11)
- [ ] T-15 `actions.setManagementFee(propertyId,feeBps)` (owner:manage) + audit. (FR-3)
- [ ] T-16 `actions.recordOwnerPayout(propertyId,periodMonth)` — pull `profitReport`, `computePayout`, insert snapshot (unique/idempotent), `OwnerPayoutRecorded` + audit. Integration AC-15. (FR-12)
- [ ] T-17 `actions.markPayoutPaid(payoutId,paymentRef)` — COMPUTED→PAID + `paidAt`/`paymentRef`, append-only, `OwnerPayoutPaid` + audit. Integration AC-16. (FR-13)
- [ ] T-18 `queries.listOwnerPayouts` + `statement.tsx` PDF + `/owner/payouts` + `[payoutId]` GET (authorized). Owner view-only. (FR-14, AC-17)
- [ ] T-19 Manage widget on `/properties/[id]`: set fee, compute/record + mark-paid (payout-manage). (FR-3/12/13)

## Phase 6 — Hardening
- [ ] T-20 RBAC negatives: owner cross-property 403 (AC-2), owner no-PII (AC-3), owner cannot manage/payout (AC-19), reception denied (AC-18), owner cannot delete staff docs (AC-9).
- [ ] T-21 Events in `lib/events/catalog.ts`; confirm none on the SSE broadcast allow-list (owner/financial data).
- [ ] T-22 E2E (mobile): owner sign-in → home → download document → view payout statement.
- [ ] T-23 `/review-module` clean; every AC mapped to a green test; DoD satisfied; scope.md + rbac-matrix updated.
