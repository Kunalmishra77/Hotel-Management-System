# Cross-Module & Provider Contracts

The exact interfaces a module exposes to others, and the provider interfaces integrations implement. This is the compile-time boundary — a caller depends on these signatures, never on internals. Money is `bigint` **paise** on accumulating amounts, `number` paise on bounded ones. All actions return `Result<T> = {ok:true,data:T} | {ok:false,error:ErrorCode}`.

## Cross-module public actions (synchronous)

```ts
// 02-room  (called by 03, 10, 11)
changeRoomStatus(roomId, to: RoomStatus): Promise<Result<void>>
blockRoom(roomId, range: DateRange, reason: string, jobId?: string): Promise<Result<{blockId: string}>>
unblockRoom(blockId): Promise<Result<void>>

// 03-reservations  (called by 13, 23)
searchAvailability(in: {propertyId; range; categoryId?; adults; children}): Promise<Result<RoomAvailability[]>>   // excludes RoomAllocation overlaps, live holds, AND overlapping RoomBlock rows
createReservation(in: ReservationInput): Promise<Result<{reservationId}>>
createFromChannel(payload: CanonicalChannelReservation): Promise<Result<{reservationId; needsAttention?: 'OVERSELL'|'MAPPING_MISSING'}>>  // ingests even when no room free → needs-attention, never drops a paid OTA booking
holdReservation(in: HoldInput): Promise<Result<{reservationId; holdExpiresAt}>>
confirmReservation(reservationId): Promise<Result<void>>                    // promotes a hold ENQUIRY→CONFIRMED + ensureFolio
reallocateRoom(reservationId, toRoomId?): Promise<Result<{roomId}>>          // 23 FR-8 equivalent-room; toRoomId omitted → auto-pick same category
modifyReservation(id, changes): Promise<Result<void>>
cancelReservation(id, reason): Promise<Result<void>>                         // releases allocations, room → VACANT
markNoShows(propertyId, businessDate): Promise<Result<{count: number}>>      // signature carries propertyId

// 04-guest  (called by 13, 23)
upsertGuest(in: GuestInput, opts?: {confirmDuplicate?}): Promise<Result<{guestId} | {duplicates: GuestMatch[]}>>

// 06-billing  (called by 03, 14, 19, 23, 25)
ensureFolio(reservationId): Promise<Result<{folioId}>>                       // idempotent
ensureDirectSaleFolio(propertyId): Promise<Result<{folioId}>>               // folio-less/house folio for walk-in POS (Folio.reservationId null)
getBalance(reservationId): Promise<Result<{balancePaise: bigint}>>
postFolioCharge(folioId, line: ChargeInput): Promise<Result<{lineId}>>      // room/POS/misc; canonical name (NOT postCharge)
reverseFolioLine(lineId, reason): Promise<Result<{reversalLineId}>>         // append-only reversal (POS void, corrections)
postRoomCharges(propertyId, businessDate): Promise<Result<{posted: number}>> // night-audit room-night posting; idempotent (partial-unique on FolioLine)
settlePosSaleDirect(in: DirectSaleInput): Promise<Result<{invoiceId; paymentId}>>  // walk-in: uses ensureDirectSaleFolio + gap-free GST invoice
recordPayment(folioId, tenders: Tender[]): Promise<Result<{batchId}>>       // split = many Payment rows, one batchId
refund(folioId, amountPaise, reason): Promise<Result<void>>
generateInvoice(folioId, billTo, type?: InvoiceType): Promise<Result<{invoiceId; number}>>  // credit notes draw the SAME series
corporateReceivable(corporateId): Promise<Result<{receivablePaise: bigint}>> // 25 reads via this, not a foreign SELECT
guestBilling(guestId): Promise<Result<{revenuePaise: bigint; outstandingPaise: bigint; bills: BillRef[]}>>  // guest-scoped folio roll-up (revenue net-of-discount tax-excluded); 05 derives history in ONE call, not a per-reservation fan-out; same derivation as reporting so 05 reconciles to the paisa with 14
validateCoupon(code, ctx: {orgId; propertyId; categoryId?; guestId; bookingPaise}): Promise<Result<{discountPaise; couponId}>>  // preview only, no state change (used by 23 + front desk)
applyCoupon(target: {folioId} | {reservationId}, code, guestId): Promise<Result<{discountPaise}>>  // ATOMIC: row-lock Coupon → re-check validity/limits → increment timesUsed → insert CouponRedemption → post DISCOUNT FolioLine → emit CouponRedeemed
createCoupon(input) / pauseCoupon(id) / expireCoupon(id): Promise<Result<...>>  // coupon:manage

// 09-staff  (read by 21)
getStaffForPayroll(propertyId, month): Promise<StaffWithAttendance[]>       // salary + joinedOn/leftOn/isActive + RAW per-day attendance (for lopDays)
attendanceSummary(propertyId, month): Promise<AttendanceSummary[]>

// 11-maintenance  (called by 10)
createJob(in: MaintenanceJobInput): Promise<Result<{jobId}>>

// 12-communications  (called by 18)
recordSentiment(feedbackId, label, score): Promise<Result<void>>           // 18 never writes Feedback directly

// 14-analytics  (metric library reused by 08; calls 06 & 03)
metrics: { occupancy; adr; revpar; availableRoomNights; occupiedRoomNights; profit }   // pure fns, the single authority
runNightAudit(propertyId, businessDate, opts?: {manual?}): Promise<Result<Snapshot>>   // calls 06.postRoomCharges + 03.markNoShows

// 15-search  (executes 18-ai's compiled queries)
search(query: UnifiedSearchQuery): Promise<Result<SearchResult[]>>          // multi-entity keyword + filters; cursor over a normalized result stream
validateStructuredQuery(query: StructuredQuery): Result<StructuredQuery>    // the 18-ai NL→query path (field allow-list)

// 18-ai  (called by 24)
suggestRates(propertyId, categoryId, range): Promise<Result<RateSuggestion[]>>  // 24 calls this; 24 writes the DynamicRate(SUGGESTED) row

// 21-payroll  (read by 08)
getFinalizedStaffCost(propertyIds, range): Promise<Result<{propertyId; month; costPaise: bigint}[]>>

// 24-pricing  (called by 03, 23)
resolvedRate(in: {categoryId; date; negotiatedRatePaise?: bigint}): Promise<bigint>  // negotiated (from 25) passed in by caller; else approved DynamicRate → RatePlan → base

// 26-data-onboarding  (go-live import; Admin `data:import`; creates via 04/03/06 only)
getTemplate(kind): CsvTemplate
createBatch(kind, propertyId?, file, mapping): Promise<Result<{batchId}>>
validateBatch(batchId): Promise<Result<{ok; error; duplicate; rows}>>   // dry-run, NO target writes
commitBatch(batchId): Promise<Result<{created; skipped}>>               // per-row via 04.upsertGuest / 03 historical / 06 opening-balance; idempotent; emits ImportCommitted
rollbackBatch(batchId): Promise<Result<void>>                           // discard (uncommitted) or soft-void created targets via ImportRow.targetId
downloadErrors(batchId): CsvFile

// 25-corporate  (MASTER-DATA services, Tier-1; called by 06, 03, 23)
reserveCredit(corporateId, amountPaise): Promise<Result<{availablePaise: bigint}>>  // ATOMIC check-and-increment under row lock (called inside 06's settlement tx)
releaseCredit(corporateId, amountPaise): Promise<Result<void>>
getNegotiatedRate(corporateId, categoryId): Promise<bigint | null>
```

## Platform primitives (00 — used by every module)
```ts
// Request context (AsyncLocalStorage) carries {orgId, userId, propertyScope, activePropertyId, requestId, ip, device}
db.scoped(user): PrismaClient           // filters to the user's propertyScope (authorization boundary)
db.activeProperty(user): string         // the switched active property (read filter for single-property ops)
authorize(user, "module:action", propertyId?): void          // throws FORBIDDEN
emitEvent(tx, {type, aggregateId, payload}): Promise<void>   // orgId/propertyId/requestId auto-filled from request context; outbox, same tx; monotonic DomainEvent.seq assigned
writeAudit(tx, {action, entityType, entityId, before, after, reason?}): Promise<void>  // userId/requestId/ip/device auto-filled from context
requireSession(): Promise<SessionUser>  // claims: {userId, orgId, roleAssignments, resolvedPermissions, propertyScope, activePropertyId}
```

## Provider interfaces (integrations — `src/lib/*`)
```ts
interface PaymentProvider   { createOrder; capture; refund; verifyWebhook; getStatus }   // 23 auto-refund of an unconfirmed deposit uses THIS, not 06.refund
interface MessagingProvider { sendTemplate; sendSession; verifyWebhook; deliveryStatus }
interface ChannelManager    { pushAvailability; pushRates; pullReservations; ack; mapRoomType }
interface AccountingProvider { pushInvoice; pushExpense; pushPayment; reconcile }
interface LLMProvider       { complete(i:{system;messages;tools?;json?:ZodSchema}):Promise<LLMResult>; embed }
interface ObjectStorage     { put; getSignedUrl; delete }
```

## Rules
- Every cross-module call is one of these signatures — no reaching into another module's tables or components.
- **Tiering:** Corporate/TravelAgent entities + `reserveCredit`/`getNegotiatedRate` are **Tier-1 master-data services** (so 03/06/23 may call down to them); 25's CRM *reporting* (statements/aging) is Tier 7. See [module-connectivity.md](module-connectivity.md).
- Provider calls are idempotent, retried via pg-boss, signature-verified on inbound webhooks.
