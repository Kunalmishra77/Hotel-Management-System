# Module Connectivity Map

How the 26 modules wire together. Three views: **dependency tiers** (build order), **direct calls** (module → another module's public action), and **event flows** (emit → consume). Rule: a module reaches another only via its `actions.ts`/`queries.ts` or via domain events — never foreign SELECTs ([architecture.md](../../.claude/rules/architecture.md)).

## 1. Dependency tiers (build order — a module depends only on lower/equal tiers)
```
Tier 0  00-platform · 01-property · 02-room-inventory · 17-mobile(substrate)
Tier 1  04-guest-crm · 03-reservations · 16-access-control(on 00)
Tier 2  06-billing · 05-guest-history · 07-expenses · 09-staff · 10-housekeeping · 11-maintenance
Tier 3  08-profit · 14-analytics · 15-search-export
Tier 4  12-communications · 18-ai
Tier 5  13-ota · 23-booking-engine · 24-dynamic-pricing
Tier 6  19-pos · 20-inventory · 21-payroll · 22-accounting-sync
Tier 7  25-corporate-crm (CRM reporting: statements/aging/dashboards) · 26-data-onboarding (go-live import)
```
**Split-tier note (resolves the inversion):** `Corporate`/`TravelAgent` **entities** + the `reserveCredit`/`releaseCredit`/`getNegotiatedRate` **services** are **Tier-1 master data** (they must exist before reservations reference them, and 03/06/23 legitimately call down to them). Only module 25's *reporting* features (account statements, aging, commission dashboards) are Tier 7. So there is **no upward call**: 06 (Tier 2) → 25-services (Tier 1) is downward and valid.

## 2. Direct calls (synchronous, via public actions/queries)
| Caller | → Callee | Purpose |
|---|---|---|
| 03-reservations | 02-room | `changeRoomStatus`, `blockRoom` (status/availability) |
| 03-reservations | 06-billing | `ensureFolio`, `getBalance` (checkout gate) |
| 03-reservations | 25-services | `getNegotiatedRate` (corporate booking) → then 24 |
| 03-reservations | 24-pricing | `resolvedRate({categoryId,date,negotiatedRatePaise?})` |
| 14-analytics | 06-billing | `postRoomCharges(propertyId, businessDate)` (night audit) |
| 14-analytics | 03-reservations | `markNoShows(propertyId, businessDate)` (night audit) |
| 06-billing | 25-services | `reserveCredit` (ATOMIC, inside settlement tx) |
| 18-ai | 12-comms | `recordSentiment` (write sentiment label) |
| 24-pricing | 18-ai | `suggestRates` (24 calls AI, then writes DynamicRate) |
| 23-booking-engine | 25-services | `getNegotiatedRate` |
| 23 / front-desk | 06-billing | `validateCoupon` / `applyCoupon` (§11 redeemable discount coupons) |
| 26-data-onboarding | 04 / 03 / 06 | `upsertGuest` / historical reservation / opening-balance `postFolioCharge` (go-live import; never a foreign INSERT) |
| 10-housekeeping | 02-room | `changeRoomStatus` (mark clean) |
| 10-housekeeping | 11-maintenance | `createJob` (complaint → job) |
| 11-maintenance | 02-room | `blockRoom`/`unblockRoom` (out-of-order) |
| 13-ota | 03-reservations | `createFromChannel`, `modify`, `cancel`, `searchAvailability` |
| 13-ota | 04-guest | resolve/create guest |
| 19-pos | 06-billing | `postFolioCharge`, `settlePosSaleDirect` |
| 21-payroll | 09-staff | read Staff + Attendance (query layer) |
| 23-booking-engine | 03/04/06/24 | hold → confirm, guest upsert, folio+payment, rate |
| 24-pricing | 18-ai (optional) | smarter rate suggestion |
| 15-search | 03/04/06/07/09 | federated search over owning query layers |
| 08-profit | 14/06/07/21 | metric library + revenue/expense/staff cost |
| 16-access | 00-platform | uses auth/RBAC/audit/backup primitives |
| all modules | 00-platform | `db.scoped`, `authorize`, `emitEvent`, `writeAudit`, session |

## 3. Event flows (async, outbox → idempotent consumers)
| Emitter | Event | Consumers |
|---|---|---|
| 01 | `PropertyCreated` | 14 |
| 02/10 | `RoomStatusChanged` | 17(SSE), 01, 14 |
| 03 | `ReservationCreated/Modified/Cancelled` | 12, 14, 13 |
| 03/04 | `GuestCheckedIn` | 12, 10, 14 |
| 03/06 | `GuestCheckedOut` | 12, 10, 14, 05 |
| 06/19 | `FolioCharged` | 14, 05 |  (22 consumes `InvoiceIssued`, not raw charges) |
| 06 | `PaymentReceived` | 12, 14, 22, 05, 25 |
| 06 | `PaymentRefunded` | 12, 22 |
| 06 | `InvoiceIssued` | 12, 22 |
| 06/14 | `PaymentDueDetected` | 12 |
| 07 | `ExpenseRecorded` | 14, 22 |
| 21 | `PayrollFinalized` | 08, 14, 22 |
| 12 | `FeedbackReceived` | 18 |
| 14 | `NightAuditCompleted` | 08, analytics |
| 13 | `ChannelReservationPulled` | 03, 12 |
| 19 | `PosOrderSettled` | 20 |
| 20 | `LowStockDetected` | 12 |
| 11 | `MaintenanceScheduled` | 12 |
| 24 | `DynamicRateApproved` | 13, 03, 23 |
| 23 | `WebBookingConfirmed` | 14, 12 |

## 4. Integration seams (external, via `lib/*` interfaces)
| Module | Interface | External |
|---|---|---|
| 06, 23 | `PaymentProvider` | Razorpay/Cashfree |
| 12 | `MessagingProvider` | WhatsApp/SMS/Email |
| 13 | `ChannelManager` | OTAs/aggregator |
| 22 | `AccountingProvider` | Tally/Zoho |
| 18 | `LLMProvider` | Anthropic/OpenAI/local/mock |
| 00, 04 | object storage | S3/MinIO |

## 5. Connectivity invariants
- **One availability truth**: 03 owns `RoomAllocation`; 13 (OTA) and 23 (web) both go through 03 → the DB exclusion constraint prevents cross-channel overbooking.
- **All money in 06**: 19-POS, 23-web, 25-corporate never write folio/payment/invoice rows — they call 06.
- **Staff cost once**: 21 is the single source (via `PayrollFinalized`); 07 never hand-keys salary.
- **Metrics once**: 14 owns the metric library; 08 and dashboards reuse it (no divergent math).
- **Events, not polling**: comms/AI/analytics/accounting/inventory react to events; adding a consumer never touches a write path.

Visual context: [high-level-architecture.md](high-level-architecture.md) · [domain-events.md](domain-events.md) · [ERD](../entities/erd.md).
