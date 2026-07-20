# 25 · Corporate CRM — User Stories & Acceptance Criteria

Roles per `rules/user-roles.md`.

## Test Fixtures
| Ref | Value |
|---|---|
| ACME | Corporate, GSTIN, creditLimit ₹2,00,000, current receivable ₹1,50,000 |
| TA-SKY | TravelAgent, commission 10% (1000 bps) |
| NEG-DLX | Negotiated Deluxe rate ₹3,500 for ACME |
| U-MGR | MANAGER (`corporate:manage` + `report:view-financial`) |
| U-ACC | ACCOUNTS (`corporate:manage`; no `report:view-financial`) |

## US-1 — Records & negotiated rates
- **AC-1:** Given U-MGR with `corporate:manage`, when creating ACME (limit ₹2,00,000, BigInt paise) and TA-SKY (10%), then both persist; audited. (FR-1)
- **AC-2:** Given NEG-DLX ₹3,500 for ACME, when an ACME-attributed booking resolves the Deluxe rate, then 03/23 call `getNegotiatedRate(ACME, CAT-DLX)` → ₹3,500 and pass it as `negotiatedRatePaise` into `24.resolvedRate({categoryId, date, negotiatedRatePaise})`, which returns ₹3,500 (negotiated wins the chain). (FR-4)

## US-2 — Credit
- **AC-3:** Given ACME receivable ₹1,50,000 and limit ₹2,00,000, when 06 (inside its settlement tx) calls `reserveCredit(ACME, 40,00,000 paise)`, then the atomic row-locked check-and-increment allows it and `receivablePaise` → ₹1,90,000 (BigInt); 06 is the writer. (FR-3)
- **AC-4:** Given the same, when `reserveCredit(ACME, 60,00,000 paise)` is attempted, then rejected `CREDIT_LIMIT_EXCEEDED` and `receivablePaise` is unchanged. Two concurrent settlements are serialized by the row lock — no over-limit, no lost update. (FR-3)

## US-3 — Attribution & commission
- **AC-5:** Given ACME/TA-SKY-attributed reservations over a range, when attribution runs, then revenue by corporate + by agent (top-N by revenue and room-nights) is returned (with 14/08). (FR-5)
- **AC-6:** Given TA-SKY bookings, when commission is computed, then a commission-payable summary at 10% of attributed room revenue is shown. (FR-6)

## US-4 — Statement
- **AC-7:** Given ACME, when the account statement runs, then charges/payments/balance + aging buckets are shown and exportable via 15. (FR-2/7)
- **AC-8:** Given U-ACC without financial-report permission on a scoped property, then financial figures are gated server-side. (FR-8)
