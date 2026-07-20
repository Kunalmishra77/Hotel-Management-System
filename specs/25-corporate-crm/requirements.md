# 25 · Corporate CRM — Requirements

> Source: client doc §19 (CRM for corporate sales) + §7 revenue attribution. Read with `rules/business-rules.md` (§17 credit), `prisma/schema.prisma` (`Corporate`, `TravelAgent`). Depth bar: `specs/03-reservations/*`.

## Purpose & scope
Manage corporate clients and travel agents: their profiles, negotiated/contract rates, credit limits, revenue attribution, and account statements (receivables/aging). Reservations (03) attribute to a corporate/agent; billing (06) settles on corporate credit against the limit this module tracks.

**In scope:** corporate/travel-agent CRUD; credit limits + current receivable/aging; negotiated rate agreements; revenue attribution reports (top corporates/agents); account statements; agent commission tracking.
**Out of scope:** the reservation attribution field itself (03 owns it — this module reads it), folio settlement mechanics (06 — calls this module's credit check), the metric definitions (reporting.md/14).

## Dependencies
- **Split tier (module-connectivity):** the `Corporate`/`TravelAgent` entities + `reserveCredit`/`releaseCredit`/`getNegotiatedRate` services are **Tier-1 master data** (must exist before reservations reference them; 06/03/23 legitimately call down to them). Only 25's **reporting** (statements/aging/commission/attribution) is **Tier 7**.
- **Tier 0–2 (for reporting):** 00, 01, 03 (attributed reservations), 06 (settles corporate credit via `reserveCredit`; owns the receivable write), 14 (segment metrics), 05 (history).
- **Consumed by:** 06 (`reserveCredit`/`releaseCredit` inside its settlement tx), 03/23 (`getNegotiatedRate`), 08/14 (segment revenue), 12 (corporate comms).

## Data owned
`Corporate` (incl. cached `receivablePaise` **BigInt**), `TravelAgent` (`commissionBps`), `NegotiatedRate(corporateId, roomCategoryId, ratePaise)` — all **confirmed present in canonical schema** (migration materializes the slice; nothing new). Money that accumulates (`creditLimitPaise`, `receivablePaise`) is **BigInt** per `.claude/rules/data-model.md`. **Tiering:** the `Corporate`/`TravelAgent` **entities** and the `reserveCredit`/`releaseCredit`/`getNegotiatedRate` **services** are **Tier-1 master data** (06/03/23 call down to them); only 25's *reporting* (statements/aging/commission/attribution) is Tier 7 — so there is no upward call.

## Functional requirements (EARS)
- **FR-1 (ubiquitous):** Maintain `Corporate` (name, GSTIN, contacts, `creditLimitPaise` **BigInt**) and `TravelAgent` (name, `commissionBps`, contacts) per org, gated on `corporate:manage` (per `rbac-matrix.md`: corporate/agent + negotiated rates + credit limits).
- **FR-2 (ubiquitous):** Track each corporate's current **receivable** as the cached `Corporate.receivablePaise` (**BigInt**) — the **writer is 06**, which increments/decrements it via this module's `reserveCredit`/`releaseCredit` services under a row lock — plus derived aging buckets. 25's reporting reads it (25 never SELECTs 06's folios directly).
- **FR-3 (event):** When 06 settles a folio on `CORPORATE_CREDIT`, it calls **`reserveCredit(corporateId, amountPaise)` inside its settlement transaction** — an **ATOMIC check-and-increment under a row lock on `Corporate`**: if `amountPaise > creditLimitPaise − receivablePaise` reject (`CREDIT_LIMIT_EXCEEDED`) and nothing changes; else atomically increment `receivablePaise` and return the new `availablePaise`. No async/serialized increment — the check and the write are one locked step. (FR-17 of 06)
- **FR-4 (ubiquitous):** Expose `getNegotiatedRate(corporateId, categoryId): bigint | null` (Tier-1 service) so 03/23 fetch a corporate's negotiated rate and **pass it into `24.resolvedRate({categoryId, date, negotiatedRatePaise?})`** (where it wins the resolution chain); 25 does not itself apply the rate at booking.
- **FR-5 (ubiquitous):** Provide attribution reports: revenue by corporate client and by travel agent, top-N by revenue and room-nights, over a date range (with 14/08).
- **FR-6 (ubiquitous):** Track travel-agent commission (bps) on attributed bookings and expose a commission payable summary.
- **FR-7 (ubiquitous):** Provide an account statement per corporate (charges, payments, balance, aging) — exportable via 15.
- **FR-8 (ubiquitous):** Every corporate/agent mutation is org-scoped, authorized server-side against `corporate:manage`, audited, and emits its event; accumulating money is **BigInt paise**. Financial reports (statements/attribution) additionally gate on `report:view-financial`.

## Non-functional (cited)
Statement/attribution queries within budget via indexes + snapshots; credit check is fast (on the 06 settlement path, p95 < 800ms). (`non-functional-requirements.md`)

## Business rules referenced
`business-rules.md` §17 (guest/corporate history derived), §20–21; `reporting.md` (segment revenue by corporate/agent).
