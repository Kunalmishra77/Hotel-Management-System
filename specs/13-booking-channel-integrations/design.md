# 13 · Booking Channel Integrations — Design

## Schema slice (from canonical `prisma/schema.prisma`)
Owns `ChannelAccount` (`@@unique([propertyId, provider])`), `RoomTypeMapping`. Writes `IntegrationInbox` (owned by 00) for dedupe. Never re-implements availability (that's 03).

**Schema notes — all confirmed present in the canonical schema** (migration materializes the slice; nothing here is new): `ChannelSyncLog(id, channelAccountId, direction[IN|OUT], type, status[PENDING|OK|FAILED|DEAD_LETTER|NEEDS_ATTENTION], externalId, error, createdAt)` — present, backs the health view + dead-letter tracking **and the oversell/needs-attention queue** (see Overbooking safety); `ChannelAccount.certifiedAt`/`credentialsRef` (activation gate) — present; `Reservation.channelAccountId` (which account sourced it) — present.

## Domain layer (pure) — `features/booking-integrations/domain/`
- `mapRoomType(mapping, externalType): categoryId | null` (FR-4/7).
- `availabilityDelta(event): {categoryId, dateRange}` — what to re-push (FR-9).
- `normalizeInbound(provider, raw): CanonicalReservation` — per-provider → canonical shape.

## `ChannelManager` interface (`src/lib/integrations/channel`)
`pushAvailability`, `pushRates`, `pullReservations`, `ack`, `mapRoomType`. Adapters: per-OTA or aggregator (SiteMinder/STAAH/eZee/Djubo/RateGain), + **MockChannelManager** (default, deterministic fixtures). All calls idempotent, retried (pg-boss), signature-verified inbound.

## Application — actions & workers (`features/booking-integrations`)
- `connectChannel`, `mapRoomType`, `activateChannel` (`integration:manage`; activate gated on certification — FR-1/16/17).
- `processInboundReservation(inboxRow)` (worker): normalize → map type → resolve/create guest (04) → `03.createFromChannel` (or modify/cancel) → **if the result carries `needsAttention` ('OVERSELL'|'MAPPING_MISSING'), write a `ChannelSyncLog(status=NEEDS_ATTENTION)` + alert (see Overbooking safety)** → emit `ChannelReservationPulled` → `ack`. Dedupe via inbox `(provider, externalId)`. (FR-5/6/8/12/15)
- Event consumers: on `ReservationCreated/Modified/Cancelled`, `RoomStatusChanged` → recompute + `pushAvailability`; on `DynamicRateApproved` (24) → `pushRates`. (FR-9/10)
- Webhook `/api/webhooks/channels/{provider}`: verify signature → inbox insert → enqueue processing. (FR-14)
- `channelHealth(propertyId)` query. (FR-19)

## Overbooking safety (FR-11/12)
OTA bookings call the **same** `03.createFromChannel` → same `RoomAllocation` + the `room_no_overlap` DB exclusion constraint. `03.createFromChannel` **ingests even when no room is free** and returns `{reservationId, needsAttention?: 'OVERSELL'|'MAPPING_MISSING'}` (never drops a paid OTA booking — `contracts.md`).

**Needs-attention persistence:** when `createFromChannel` returns a `needsAttention` value, this module persists a **`ChannelSyncLog` row with `status='NEEDS_ATTENTION'`** (direction `IN`, `externalId` = the OTA ref, `error` = the reason `OVERSELL`/`MAPPING_MISSING`). That status value **is** the needs-attention queue the UI reads and the health view counts — there is no separate flag or channel-side inventory ledger. For `OVERSELL` the module also alerts reception with `CHANNEL_OVERSELL`, emits `ChannelOversellDetected`, and immediately re-pushes corrected availability. A row leaves the queue when an operator resolves it (re-room / cancel), flipping its status to `OK`.

## UI — wireframes (mobile-first, `features/booking-integrations/components/`)
```
┌───────────────────────────┐
│ Channels · MG Road        │
│ ┌───────────────────────┐ │
│ │ Booking.com   ● sandbox│ │
│ │ last sync 2m · 0 dead │ │
│ │ [Map room types][Live]│ │  ← "Live" disabled w/o cert
│ └───────────────────────┘ │
│ Needs attention (1) ⚠     │
│ ▸ Oversell BDC-9002 DLX   │
└───────────────────────────┘
```
Room-type mapping screen: external types ↔ internal categories. Needs-attention queue for oversell/mapping-missing.

## Events
Emits: `ChannelReservationPulled`, `ChannelPushed` (outbound availability/rate push), `ChannelOversellDetected` (needs-attention oversell). Consumes: `ReservationCreated/Modified/Cancelled`, `RoomStatusChanged`, `DynamicRateApproved` (24 → `pushRates`). Catalog: `docs/architecture/domain-events.md`.

## Sequences
**Inbound:** webhook (verify sig) → inbox insert (dedupe) → worker → map type → resolve guest (04) → `03.createFromChannel` → `ChannelReservationPulled` + audit → `ack`. **Outbound:** availability event → `availabilityDelta` → enqueue `pushAvailability` per mapped active channel → provider call (sandbox=outbox log) → retry/dead-letter on failure.

## Error catalog
`CHANNEL_NOT_CERTIFIED`, `MAPPING_MISSING`, `CHANNEL_OVERSELL`, `SIGNATURE_INVALID`, `FORBIDDEN`, `PROVIDER_ERROR`.

## Edge cases
- Duplicate webhook → inbox dedupe (FR-5).
- Modify/cancel for unknown channelRef → dead-letter + alert.
- Push while sandbox/inactive → outbox only (FR-18).
- Aggregator vs direct-OTA cert → same interface, different adapter; no call-site change.
- Certification is a **client/business step** — no code path bypasses it.
