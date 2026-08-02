# 25 · Corporate CRM — Tasks

Test-first for credit/aging/commission. Each ends at `rules/definition-of-done.md`. `(AC-n)/(FR-n)`.

## Schema & migration
- [x] T-1 `Corporate` (BigInt `creditLimitPaise`/`receivablePaise`), `TravelAgent`, and `NegotiatedRate` are **confirmed present in canonical schema**; migration materializes the slice.
- [x] T-2 Seed fixtures (ACME, TA-SKY, NEG-DLX, attributed reservations).

## Domain (tests first)
- [x] T-3 `availableCredit` (BigInt) — the predicate `reserveCredit` applies under lock. (FR-3, AC-3/4)
- [x] T-4 `aging` buckets. (FR-2/7, AC-7)
- [x] T-5 `commissionPayable`. (FR-6, AC-6)
- [x] T-6 `getNegotiatedRate(corporateId, categoryId)` service (03/23 pass result into `24.resolvedRate`). (FR-4, AC-2)

## Application (integration tests)
- [x] T-7 `createCorporate/createAgent` + audit. (FR-1, AC-1)
- [x] T-8 `setNegotiatedRate` (`corporate:manage`); `getNegotiatedRate` read resolved by 03/23. (FR-4, AC-2)
- [x] T-9 `reserveCredit` service called by 06 inside its settlement tx: **atomic** `SELECT … FOR UPDATE` check-and-increment — allow within limit, reject `CREDIT_LIMIT_EXCEEDED` over, concurrent-safe (no over-limit/lost update); `releaseCredit` on payment/void. (FR-3, AC-3/4)
- [x] T-10 `attributionReport`/`agentCommission`. (FR-5/6, AC-5/6)
- [x] T-11 `corporateStatement` + aging + export via 15. (FR-2/7, AC-7)
- [x] T-12 RBAC: `corporate:manage` for mutations, `report:view-financial` for statements/attribution — gated server-side. (FR-8, AC-8)

## UI (mobile-first)
- [x] T-13 Corporate/agent list + credit gauge + statement + commission. (AC-1/3/6/7)

## E2E
- [x] T-14 Journey: create corporate + negotiated rate → attributed booking uses it → settle on credit within limit → statement shows receivable. (AC-1/2/3/7)

## Done
- [x] T-15 `/review-module` clean; credit check consistent with 06; every AC → green test; DoD satisfied.
