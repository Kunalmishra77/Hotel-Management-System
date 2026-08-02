# 01 · Property Management — Tasks

Ordered, test-first for domain. Each ends at `rules/definition-of-done.md`. `(AC-n)/(FR-n)` = traceability.

## Schema & migration
- [x] T-1 Confirm `Property`/`Floor` slice; migration; indexes `Property(orgId)`, `Room(propertyId,status)` (for occupancy). (FR-1,4,6)
- [x] T-2 Seed fixtures (ORG, PROP-A/B, users, ROOMS-A) for tests.

## Domain (write tests first)
- [x] T-3 `validateGstin()` valid/invalid cases. (FR-3, AC-3)
- [x] T-4 `occupancyRollup()` counts + occupancy bps. (FR-6, AC-6)

## Application (integration tests)
- [x] T-5 `createProperty()`/`updateProperty()` with code-uniqueness + GSTIN validation + event + audit. (FR-1/2/3/9, AC-1/2/3)
- [x] T-6 `addFloor()`/`reorderFloors()` with duplicate rejection. (FR-4, AC-4)
- [x] T-7 `deactivateProperty()` soft-delete retains history; blocks if in-house. (FR-5, AC-5)
- [x] T-8 RBAC: manager/other roles denied create. (FR-8, AC-9)
- [x] T-9 Validation rejects missing required fields. (AC-10)

## Queries & realtime
- [x] T-10 `listProperties()`/`getProperty()` property-scoped. (FR-8, AC-8)
- [x] T-11 `propertyOverview()` indexed count query + occupancy rollup. (FR-6, AC-6)
- [x] T-12 Subscribe `RoomStatusChanged` → live tile update < 2s. (FR-7, AC-7)

## UI (mobile-first)
- [x] T-13 Multi-property overview with occupancy bars + realtime. (AC-6/7/8)
- [x] T-14 Property create/edit form with inline code/GSTIN validation. (AC-1/3)
- [x] T-15 Floors management UI. (AC-4)

## E2E
- [x] T-16 Journey: admin creates property → adds floors → sees it in overview. (AC-1/4/6)

## Done
- [x] T-17 `/review-module` clean; every AC → green test; DoD satisfied.
