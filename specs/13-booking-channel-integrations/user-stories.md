# 13 · Booking Channel Integrations — User Stories & Acceptance Criteria

Roles per `rules/user-roles.md`; integration behavior per `integrations.md`. **One availability truth** = 03.

## Test Fixtures
| Ref | Entity | Value |
|---|---|---|
| PROP-A | Property | Karnataka |
| CH-BDC | ChannelAccount | provider `booking_com`, sandbox, inactive |
| MAP-DLX | RoomTypeMapping | external "DLX-BB" → internal CAT-DLX |
| RES-EXT | Inbound OTA reservation | externalId `BDC-9001`, room type "DLX-BB", 12–15 Jul |
| U-ADMIN | User | ADMINISTRATOR (`integration:manage`) |
| U-REC | User | RECEPTION (no `integration:manage`) |
| MODE | `CHANNEL_MODE` | sandbox (mock adapter) |

## US-1 — Connect & map
- **AC-1:** Given U-ADMIN, when connecting `booking_com` for PROP-A, then a `ChannelAccount(sandbox, isActive=false)` is created. (FR-1)
- **AC-2:** Given CH-BDC, when mapping external "DLX-BB" → CAT-DLX, then `RoomTypeMapping` persists; an external type without a mapping cannot be ingested. (FR-4)
- **AC-3:** Given U-ADMIN attempts to activate CH-BDC to live **without** certification credentials, then rejected `CHANNEL_NOT_CERTIFIED`; it stays sandbox. (FR-17)

## US-2 — Inbound reservations (dedupe → 03)
- **AC-4:** Given RES-EXT arrives (sandbox mock), when processed, then it is recorded in `IntegrationInbox` keyed `(booking_com, BDC-9001)` and a reservation is created via `03.createFromChannel` with source `BOOKING_COM` + `channelRef=BDC-9001`, consuming the **same availability** as direct. (FR-5/6)
- **AC-5:** Given RES-EXT is re-delivered (same externalId), when processed again, then deduped — no duplicate reservation. (FR-5)
- **AC-6:** Given an inbound room type with **no** mapping, when processed, then no reservation; inbox row dead-lettered `MAPPING_MISSING` + admin alert. (FR-7)
- **AC-7:** Given an inbound **modify** for `BDC-9001`, then `03.modifyReservation` applied; a **cancel** → `03.cancelReservation` releasing inventory. (FR-8)
- **AC-8:** Given a successful create, then `ChannelReservationPulled(externalId→reservationId)` emitted, audited, and the channel `ack`ed. (FR-15)

## US-3 — Outbound push (one truth)
- **AC-9:** Given `ReservationCreated` reduces Deluxe availability, when the event is consumed, then availability for the affected category/date is recomputed and `pushAvailability` is enqueued to every active mapped channel. (FR-9)
- **AC-10:** Given a `DynamicRateApproved` event (from 24) for Deluxe, when consumed, then `pushRates` is enqueued to mapped channels. (FR-10)
- **AC-11:** Given MODE=sandbox, when a push runs, then it is logged to the outbox and sent to no real OTA; the flow still completes. (FR-3/18)

## US-4 — Reliability & oversell
- **AC-12:** Given a channel oversell (paid OTA booking with no free room from sync lag), when ingested (`03.createFromChannel` returns `needsAttention='OVERSELL'`), then a `ChannelSyncLog(status=NEEDS_ATTENTION)` row is written (the needs-attention queue), reception is alerted `CHANNEL_OVERSELL`, `ChannelOversellDetected` is emitted, and corrected availability is re-pushed — the booking is never silently dropped. (FR-12)
- **AC-13:** Given a push/pull fails, when retried, then exponential backoff via pg-boss; after max attempts, dead-letter + admin alert; **front desk never blocked**. (FR-13)
- **AC-14:** Given an inbound webhook with missing/invalid signature, then rejected `SIGNATURE_INVALID` with no side effects. (FR-14)
- **AC-15:** Given CH-BDC, when the health view loads, then it shows connected state, `lastSyncAt`, pending + dead-lettered counts. (FR-19)

## Permission / negative
- **AC-16:** Given U-REC (no `integration:manage`), when connecting/mapping/activating, then `FORBIDDEN`. (FR-16)
