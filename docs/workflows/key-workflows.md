# Key Workflows (end-to-end sequences)

The critical cross-module journeys, consolidated. Per-module detail lives in each spec's `design.md`.

## 1. Direct booking → stay → GST invoice
```
Reception → 03 createReservation (SERIALIZABLE txn; exclusion constraint = no overbooking)
   → 06 ensureFolio → emit ReservationCreated → 12 confirmation, 14 pace
Check-in → 03 checkIn → room OCCUPIED (02) → GuestCheckedIn → 12 welcome, 10 task
During stay → 06 postFolioCharge (room via night audit, F&B via 19 POS) → FolioCharged
Payment → 06 recordPayment (split supported) → PaymentReceived → 12 receipt
Check-out → 06 getBalance gate (block unless settled/deferred) → 03 checkOut
   → room HOUSEKEEPING (02/10) → GuestCheckedOut → 12 thank-you/review/invoice
Invoice → 06 generateInvoice (row-locked gap-free series, GST split, PDF) → InvoiceIssued → 22 accounting
```

## 2. Night audit (per property, nightly)
```
14 runNightAudit (advisory lock + unique guard, idempotent)
   → 06 postRoomCharges (one ROOM line per in-house folio, tariff GST)
   → 03 markNoShows (release, apply policy)
   → write immutable DailyStatSnapshot (occupancy/ADR/RevPAR)
   → roll Property.currentBusinessDate + lock closed day
   → NightAuditCompleted → 08 reports, PaymentDueDetected → 12 reminders
Failure part-way → run FAILED, no event, date unchanged, safe re-run.
```

## 3. OTA inbound reservation (one availability truth)
```
OTA/aggregator webhook → 00 IntegrationInbox (verify signature, dedupe on provider id)
   → 13 processInboundReservation → map room type → 04 resolve/create guest
   → 03 createFromChannel (SAME RoomAllocation + exclusion constraint as direct)
   → ChannelReservationPulled → ack channel → 12 confirmation
Availability change (any source) → 13 pushAvailability to active channels.
```

## 4. Public web booking (23)
```
Guest → GET availability (03 truth + 24 rate, GST-inclusive)
   → POST hold: 04 upsert guest + 03 holdReservation (TTL) + 06/gateway order → BookingEngineOrder
Payment webhook (verify sig, inbox dedupe):
   success → one txn: 03 confirm + 06 advance + order PAID → WebBookingConfirmed → 12
   hold lost → re-allocate or 06 auto-refund (never overbook)
   fail/expire → 03 release hold, order terminal
```

## 5. POS order → folio / stock
```
19 createOrder (OPEN, derived total) → sendToKitchen (KOT)
Settle: in-house → 06 postFolioCharge (FolioLine type=POS, GST) ; walk-in → 06 settlePosSaleDirect (payment + GST doc)
   → PosOrderSettled → 20 deduct stock per recipe → LowStockDetected → 12 reminder
```

## 6. Payroll run (monthly)
```
21 generateRun (reads 09 Staff+Attendance) → DRAFT lines (base/OT/net, paise)
   → adjustLine (bonus/deduction/advance; overrides audited)
   → finalizeRun → lock + payslip PDFs → PayrollFinalized → 08/14 cost, 22 salary journal
Correction after finalize → new adjustment run (never edit a finalized run).
```

## 7. Corporate credit settlement
```
06 settle folio on CORPORATE_CREDIT → 25 reserveCredit (ATOMIC, row-locked, inside 06's tx)
   within limit → receivable ↑ atomically ; over → CREDIT_LIMIT_EXCEEDED (rejected)
25 corporateStatement → charges/payments/aging → export via 15.
```

## 8. Guest lifecycle & compliance (04)
```
Create → dedupe (mobile/email/ID) → confirm/merge → GuestCreated
Add ID → Aadhaar masked by default (full only if compliance flag) → scan to encrypted storage
Reveal PII → permission + reason → GuestPiiAccessed + audit
DPDP export/erase → gated + audited; erase preserves financial records anonymized; blocked during active stay
```

Each sequence upholds the non-negotiables in [CLAUDE.md](../../CLAUDE.md): money in paise, server-side authz, event+audit on every mutation, availability enforced in a transaction, integrations sandbox-by-default.
