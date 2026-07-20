# 25 · Corporate CRM — Design

## Schema slice (from canonical `prisma/schema.prisma`)
Owns `Corporate` (cached `receivablePaise` **BigInt**, written by 06 via `reserveCredit`/`releaseCredit` under row lock), `TravelAgent` (`commissionBps`), `NegotiatedRate(corporateId, roomCategoryId, ratePaise)` — all **confirmed present in canonical schema** (migration materializes the slice). Statement/aging computed on demand from folios/payments (via 06's query surface). The `Corporate`/`TravelAgent` entities + the credit/rate services are **Tier-1 master data**; only reporting is Tier 7.

## Domain layer (pure) — `features/corporate-crm/domain/`
- `availableCredit(limitPaise, receivablePaise): bigint` — the pure predicate the atomic `reserveCredit` applies while holding the row lock (FR-3).
- `aging(charges, payments, asOf): Buckets` — 0-30/31-60/61-90/90+ (FR-2/7).
- `commissionPayable(bookings, bps): bigint` (FR-6).

## Tier-1 master-data services (`features/corporate-crm/services.ts`) — called down by 06/03/23
- `reserveCredit(corporateId, amountPaise): Result<{availablePaise: bigint}>` — **ATOMIC** check-and-increment under `SELECT … FOR UPDATE` on `Corporate`, invoked **inside 06's settlement transaction**; rejects `CREDIT_LIMIT_EXCEEDED` if over limit, else increments `receivablePaise`. 06 is the receivable writer. (FR-3)
- `releaseCredit(corporateId, amountPaise): Result<void>` — decrements the receivable under the same row lock (payment/void). (FR-2)
- `getNegotiatedRate(corporateId, categoryId): bigint | null` — read used by 03/23, which pass the result into `24.resolvedRate({categoryId, date, negotiatedRatePaise?})`. (FR-4)

## Application — server actions (`features/corporate-crm/actions.ts`)
Per `api-conventions.md`.
- `createCorporate/updateCorporate`, `createAgent/updateAgent` — `corporate:manage`; audited. (FR-1)
- `setNegotiatedRate(corporateId, categoryId, ratePaise)` — `corporate:manage`; `getNegotiatedRate` (service, above) is the read path 03/23 use. (FR-4)
- Credit is settled through the `reserveCredit` service (above), called by 06 inside its settlement tx — **not** a standalone `checkCredit` action. (FR-3)
- Queries (`report:view-financial`): `attributionReport(range)`, `agentCommission(range)`, `corporateStatement(corporateId, range)`. (FR-5/6/7)

## UI — wireframes (mobile-first)
```
┌───────────────────────────┐
│ ACME Corp   GSTIN 29…     │
│ Credit 2,00,000           │
│ Receivable 1,50,000 ▓▓▓░  │
│ Neg. Deluxe ₹3,500        │
│ [Statement][Bookings]     │
│ Agents ▸ Sky (10%) pay ₹.. │
└───────────────────────────┘
```
Corporate/agent list; credit gauge; statement with aging; commission summary.

## Events
Emits: `CorporateCreated`, `AgentCreated`, `NegotiatedRateSet`, `CreditThresholdReached`. Consumes: `PaymentReceived` and `CorporateReceivableChanged` (06 emits the latter after `reserveCredit`/`releaseCredit`; 25 refreshes reporting caches — it does not re-derive the receivable, 06 owns that write). Catalog: `docs/architecture/domain-events.md`.

## Error catalog
`CREDIT_LIMIT_EXCEEDED`, `FORBIDDEN`, `VALIDATION_FAILED`.

## Edge cases
- Credit race on two concurrent corporate settlements → the `SELECT … FOR UPDATE` row lock in `reserveCredit` makes each check-and-increment atomic; the second waits, re-reads the updated `receivablePaise`, and is rejected if now over limit (no over-limit, no lost update).
- Negotiated rate absent → `getNegotiatedRate` returns null → caller passes no `negotiatedRatePaise` → normal `24.resolvedRate` chain (approved→RatePlan→base).
- Agent commission only on attributed room revenue (not tax/F&B).
- `Corporate.receivablePaise` (BigInt) is the cached source, written **only** by 06 via `reserveCredit`/`releaseCredit` under row lock.
