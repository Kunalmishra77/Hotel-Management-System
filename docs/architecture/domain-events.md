# Domain Event Catalog

Every business state change emits an immutable event (persisted to `DomainEvent`, dispatched via pg-boss). Consumers react; they never poll tables. This is the authoritative list — a design that emits an event not here must add it.

## Envelope
```ts
{ id, seq /* monotonic, per-aggregate ordering */, type, orgId, propertyId, aggregateId, payload, occurredAt }
```

## Events by module

| Event | Emitted by | Key payload | Consumers |
|---|---|---|---|
| `PropertyCreated` / `PropertyUpdated` / `PropertyDeactivated` | 01 | propertyId | 14 |
| `RoomCreated` / `CategoryCreated` | 02 | roomId/categoryId | 14 |
| `RoomStatusChanged` | 02/10 | roomId, from, to | 17(SSE), 01, 14 |
| `ReservationCreated` | 03 | reservationId, source, dates | 12, 14, 13 |
| `ReservationModified` / `ReservationCancelled` | 03 | reservationId | 12, 14, 13 |
| `NoShowMarked` | 03 (via 14 audit) | reservationId | 14, 12 |
| `GuestCheckedIn` | 03/04 | reservationId, roomId | 12, 10, 14 |
| `GuestCheckedOut` | 03/06 | reservationId | 12, 10, 14, 05 |
| `GuestCreated` / `GuestUpdated` / `GuestIdAdded` | 04 | guestId | 15 index |
| `GuestPiiAccessed` | 04 | guestId, field, by, reason | audit |
| `GuestMerged` | 04 | survivorId, loserId | 05 (recompute both), 14 |
| `GuestErased` | 04 | guestId | audit |
| `GuestStatsUpdated` | 05 | guestId | (profile cache) |
| `FolioCharged` | 06/19 | folioId, type, amountPaise | 14, 05 |
| `DiscountApplied` | 06 | folioId, amountPaise, by | audit, 14 |
| `PaymentReceived` | 06 | folioId, **settlementBatchId, tenders[]{mode,amountPaise}** | 12, 14, 22, 05, 25 |
| `PaymentRefunded` | 06 | folioId, amountPaise | 12, 14, 22, 05 |
| `InvoiceIssued` | 06 | invoiceId, number, type | 12, 22 |
| `PaymentDueDetected` | 06 (checkout) / 14 (close) | folioId, balancePaise, businessDate | 12 (dedupe per folio+day) |
| `CorporateReceivableChanged` | 06 | corporateId, receivablePaise | 25 |
| `ExpenseRecorded` / `ExpenseApproved` | 07 | expenseId, head | 14, 22 |
| `NightAuditCompleted` | 14 | propertyId, businessDate, stats | 08, analytics |
| `FeedbackReceived` | 12 | feedbackId | 18 |
| `SentimentClassified` | 18 | feedbackId, label, score | 14 |
| `SegmentUpdated` | 18 | segmentId | 12 |
| `RateSuggested` | 18 | categoryId, date, suggestedPaise | 24 (writes DynamicRate) |
| `DynamicRateApproved` / `DynamicRateRejected` | 24 | categoryId, date, appliedPaise | 13, 03/23 (resolution) |
| `ChannelReservationPulled` | 13 | externalId → reservationId | 03, 12 |
| `ChannelPushed` / `ChannelOversellDetected` | 13 | channelAccountId | 12 (alert), reception |
| `MessageQueued` | 12 | messageLogId | (worker) |
| `ConsentChanged` | 12 | guestId, channel, status | — |
| `MaintenanceJobCreated` / `MaintenanceJobClosed` | 11 | jobId | 14 |
| `MaintenanceScheduled` | 11 | jobId, scheduledFor | 12 |
| `HousekeepingTaskDone` | 10 | taskId, roomId | 14 |
| `StaffCreated` / `StaffUpdated` / `AttendanceRecorded` | 09 | staffId | — |
| `PayrollRunGenerated` / `PayrollLineAdjusted` | 21 | runId | audit |
| `PayrollFinalized` | 21 | runId, month, netTotalPaise | 08, 14, 22 |
| `PosOrderSettled` | 19 | propertyId, outlet, items[] | 20 (stock), 14 |
| `PosOrderVoided` | 19 | orderId | 14 |
| `StockMovementRecorded` | 20 | itemId, delta | — |
| `LowStockDetected` | 20 | itemId | 12 |
| `WebBookingConfirmed` / `WebBookingFailed` / `WebBookingCancelled` | 23 | reservationId? | 14, 12 |
| `CorporateCreated` / `AgentCreated` / `NegotiatedRateSet` | 25 | id | — |
| `CreditThresholdReached` | 25 | corporateId | 12 |
| `UserCreated` / `RoleAssigned` / `PermissionOverrideChanged` / `SecuritySettingsChanged` / `BackupTriggered` / `SessionForceLoggedOut` | 16/00 | id | audit |
| `AccountingSynced` / `AccountingSyncFailed` | 22 | provider, entityType, entityId | admin alert |
| `DataExported` | 15 | exportJobId | audit |

## Guarantees
- **Outbox**: event persisted in the same transaction as the state change → no lost events.
- **Ordering**: `DomainEvent.seq` (monotonic) gives deterministic per-aggregate order even for multiple events in one transaction. Cross-aggregate order not assumed.
- **At-least-once** delivery with idempotent consumers (dedupe on event id). **Inbox** dedupes inbound provider events on provider id.
- **Accounting (22)** consumes `InvoiceIssued`, `PaymentReceived`, `PaymentRefunded`, `ExpenseRecorded`, `PayrollFinalized` — **not** raw `FolioCharged` (avoids double entries).
