# 13 · Booking Channel Integrations — Tasks

Test-first for mapping/normalize logic. Reliability + one-availability-truth are the crux. Each ends at `rules/definition-of-done.md`. `(AC-n)/(FR-n)`.

## Schema & migration
- [ ] T-1 Confirm `ChannelAccount`/`RoomTypeMapping`, `ChannelSyncLog` (`status` incl. `NEEDS_ATTENTION`), `ChannelAccount.certifiedAt/credentialsRef`, `Reservation.channelAccountId` (**all confirmed present in canonical schema**; migration materializes the slice). (FR-1/4/19)
- [ ] T-2 Seed fixtures (CH-BDC, MAP-DLX, RES-EXT, mock adapter).

## Domain (write tests first)
- [ ] T-3 `mapRoomType` incl. missing-mapping. (FR-4/7, AC-2/6)
- [ ] T-4 `availabilityDelta` from events. (FR-9)
- [ ] T-5 `normalizeInbound` per-provider → canonical. (FR-6)

## Interface & adapters
- [ ] T-6 `ChannelManager` interface + `MockChannelManager` (default) + contract tests. (FR-2/3)
- [ ] T-7 Signature-verify + inbox dedupe helper for inbound. (FR-14)

## Application / workers (integration tests)
- [ ] T-8 `connectChannel`/`mapRoomType` + RBAC. (FR-1/4/16, AC-1/2/16)
- [ ] T-9 `activateChannel` cert gate. (FR-17, AC-3)
- [ ] T-10 `processInboundReservation`: create via 03, source+channelRef, same availability. (FR-6, AC-4)
- [ ] T-11 Inbound dedupe (re-delivery → no duplicate). (FR-5, AC-5)
- [ ] T-12 Missing mapping → dead-letter + alert. (FR-7, AC-6)
- [ ] T-13 Inbound modify/cancel via 03. (FR-8, AC-7)
- [ ] T-14 `ChannelReservationPulled` + audit + ack. (FR-15, AC-8)
- [ ] T-15 Outbound push on availability change / `DynamicRateApproved` (24) rate change (sandbox=outbox). (FR-9/10/18, AC-9/10/11)
- [ ] T-16 Oversell → `03.createFromChannel` returns `needsAttention` → persist `ChannelSyncLog(status=NEEDS_ATTENTION)` (the queue) + `CHANNEL_OVERSELL` alert + `ChannelOversellDetected` + re-push; never drop. (FR-12, AC-12)
- [ ] T-17 Retry/backoff → dead-letter; front desk unblocked. (FR-13, AC-13)
- [ ] T-18 Invalid signature → no side effects. (FR-14, AC-14)
- [ ] T-19 One-availability-truth: OTA + direct cannot overbook the same room (uses 03 exclusion constraint). (FR-11)

## UI & health
- [ ] T-20 Channels list + health (last sync, dead-letter counts). (FR-19, AC-15)
- [ ] T-21 Room-type mapping screen + needs-attention queue. (AC-2/12)

## E2E
- [ ] T-22 Journey: connect (sandbox) → map types → mock pull creates reservation → dedupe re-delivery → availability re-push logged. (AC-1/2/4/5/9)

## Done
- [ ] T-23 `/review-module` clean; every AC → green test; DoD satisfied.
