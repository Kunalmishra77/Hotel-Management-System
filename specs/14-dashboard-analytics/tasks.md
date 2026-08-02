# 14 · Dashboard & Analytics — Tasks

Test-first for the metric library (reused everywhere) and night-audit idempotency. Each ends at `rules/definition-of-done.md`. `(AC-n)/(FR-n)` = traceability.

## Schema & migration
- [x] T-1 Confirm `DailyStatSnapshot`/`NightAuditRun` + `Property.currentBusinessDate`/`nightAuditTime` (**confirmed present in canonical schema**; migration materializes the slice); immutability guard on snapshot; unique `(propertyId,businessDate)` on both `DailyStatSnapshot` and `NightAuditRun`; migration. (FR-7/8/16)
- [x] T-2 Seed fixtures (PROP-A/B, rooms, reservations, folios, expenses, corporates) + a closed-date snapshot.

## Domain (write tests FIRST — canonical metrics)
- [x] T-3 `occupancy/adr/revpar/availableRoomNights/occupiedRoomNights/profit` per reporting.md. (FR-1/11, AC-1)
- [x] T-4 `snapshotFrom(inputs)` pure assembly. (FR-6)
- [x] T-5 Cross-check: 08 reuse yields identical values. (FR-1, AC-2)

## Night audit (integration tests)
- [x] T-6 `runNightAudit` order: `06.postRoomCharges(propertyId, businessDate)` → `03.markNoShows(propertyId, businessDate)` → snapshot. (FR-5/6, AC-7)
- [x] T-7 Idempotent re-run → no-op returns existing snapshot. (FR-7, AC-8)
- [x] T-8 Business-date roll + closed-day lock + `NightAuditCompleted` + audit. (FR-8/9, AC-9)
- [ ] T-9 Partial failure → run row set `FAILED` (upsert/reset of the existing `(propertyId,businessDate)` row, never a 2nd insert), no event, date unchanged, safe re-run. (FR-10, AC-10)
- [x] T-10 Concurrency: two runs → exactly one proceeds (advisory lock + unique). (FR-16, AC-11)
- [x] T-11 `PaymentDueDetected` on balance-due at close. (FR-17, AC-12)

## Live dashboard & realtime
- [x] T-12 `liveTiles()` indexed counts + today's arrivals/departures/revenue/expense/pending. (FR-2, AC-3)
- [x] T-13 Permission filter: financial tiles excluded server-side without `report:view-financial`. (FR-14, AC-6)
- [ ] T-14 SSE subscribe → affected-tile recompute → push < 2s. (FR-4, AC-4)
- [x] T-15 Consolidation scoped to user's properties; open=live, closed=snapshot. (FR-15, AC-5/16)

## Trends & segments
- [x] T-16 `trend()` snapshots for closed + live for open. (FR-3/12, AC-13)
- [x] T-17 `segments()` top corporates/agents/repeat guests by revenue + room-nights, **computed live** over the range via 06/05/25 query layers (not snapshotted). (FR-13, AC-14)

## UI (mobile-first)
- [x] T-18 Dashboard tiles (permission-aware) with realtime. (AC-3/4/6)
- [ ] T-19 Trends charts + segments lists. (AC-13/14)
- [x] T-20 Manual "run night audit" (permission + confirm). (AC-7)

## E2E
- [x] T-21 Journey: open dashboard → check-in updates tile live → run night audit → date rolls, snapshot visible in trends. (AC-3/4/7/9/13)

## Done
- [x] T-22 `/review-module` clean; metrics reconcile with 06/08; every AC → green test; DoD satisfied.
