# 13 · Booking Channel Integrations (OTA / Channel Manager) — Requirements

> Depth bar: `specs/03-reservations/*`. Source: client doc §12; `scope.md` row 13. Read with `.claude/rules/integrations.md` (golden rule, sandbox↔live gating, `ChannelManager` contract, OTA certification reality), `business-rules.md` §1–3 (one availability truth), `non-functional-requirements.md` (graceful integration degradation), `prisma/schema.prisma` (ChannelAccount, RoomTypeMapping, IntegrationInbox, Reservation).

## Purpose & scope
Connect the PMS to OTAs (Booking.com, Agoda, MakeMyTrip, Goibibo, Airbnb) and/or a channel-manager aggregator so that **availability and rates flow out** and **reservations flow in**, all sharing the **single availability truth** owned by `03-reservations`. This module is the connector, mapping, dedupe, and reliability layer; it never re-implements booking or availability itself.

**In scope:** the `ChannelManager` provider abstraction (`pushAvailability`, `pushRates`, `pullReservations`, `ack`, `mapRoomType`); per-property/per-provider `ChannelAccount` connection + activation gating; `RoomTypeMapping` (external room type/rate plan → internal `RoomCategory`); inbound OTA reservation ingest (new/modify/cancel) deduped via `IntegrationInbox`; creating each inbound booking through `03.createFromChannel(...)`; outbound availability/rate pushes triggered by domain events; retry/backoff/dead-letter reliability; a mock adapter so the whole flow runs in sandbox with zero external accounts; channel health surface.
**Out of scope:** reservation lifecycle, allocation, and the anti-overbooking transaction (owned by 03); folio/invoice (06); guest de-duplication internals (04 — this module *calls* it); dynamic rate computation (24 — this module *pushes* an already-approved rate); public direct booking website (23).

### External reality (be honest — code cannot bypass this)
Two-way OTA connectivity is **not** an open API you can call. Each OTA grants machine access only through a **certified connectivity partnership** (Booking.com Connectivity Partner Programme, Expedia/EPS, Agoda YCS, MakeMyTrip/Goibibo Connectivity, Airbnb API partner), which the client (or a channel-manager aggregator such as SiteMinder / STAAH / eZee Centrix / Djubo / RateGain) must hold. **We build the full connector + mapping + sandbox now; the client activates live** by supplying either per-OTA certification credentials or an aggregator account. No code path makes an uncertified channel go live — see `integrations.md` and FR-17.

## Dependencies
- **Tier 0:** 00-platform (auth, tenancy, `DomainEvent` outbox + pg-boss dispatch, `IntegrationInbox`, `AuditLog`), 01-property-management, 02-room-inventory (Room/RoomCategory/status blocks).
- **Tier 1:** 03-reservations (`searchAvailability`, `createFromChannel`, `modifyReservation`, `cancelReservation` — the one availability truth), 04-guest-crm (guest resolve/create with duplicate detection).
- **Tier 5 peers/consumers:** 24-dynamic-pricing (approved rates to push), 14-dashboard-analytics, 12-communications (react to `ChannelReservationPulled`).
- A module may depend only on lower/equal tiers (`architecture.md`); 13 reaches other modules only through their `actions.ts`/`queries.ts`.

## Data owned
`ChannelAccount`, `RoomTypeMapping`. **Writes** `IntegrationInbox` (model owned by 00) for inbound dedupe. **Reads** `Room`, `RoomCategory`, `RatePlan`/`DynamicRate`, `RoomAllocation`. **Calls** 03 (`searchAvailability`, `createFromChannel`, `modifyReservation`, `cancelReservation`) and 04 (guest resolve). `ChannelSyncLog` (incl. `status='NEEDS_ATTENTION'`) + `ChannelAccount.certifiedAt/credentialsRef` + `Reservation.channelAccountId` are **confirmed present in the canonical schema** (see design "Schema notes").

## Functional requirements (EARS)
- **FR-1 (ubiquitous):** Represent each connection as a `ChannelAccount` unique per `(propertyId, provider)`; it becomes live (`isActive=true`) only after the client supplies per-OTA certification credentials or a channel-manager aggregator account.
- **FR-2 (ubiquitous):** Provide a `ChannelManager` interface — `pushAvailability`, `pushRates`, `pullReservations`, `ack`, `mapRoomType` — that every adapter implements; application/domain code depends on the interface, never a provider SDK (`integrations.md` golden rule).
- **FR-3 (state):** While `CHANNEL_MODE=sandbox` (no live credentials), run the mock adapter so the full flow works end-to-end — pull deterministic fixture reservations, log outbound pushes to an outbox — with zero external accounts.
- **FR-4 (ubiquitous):** Map every external room type (and rate plan) to exactly one internal `RoomCategory` via `RoomTypeMapping` per channel account; an external type without a mapping cannot be ingested.
- **FR-5 (event):** When an inbound OTA message is received (webhook or pull), record it in `IntegrationInbox` keyed by `(provider, externalId)` and process it **exactly once**; a re-delivery of the same `externalId` is deduped — no duplicate reservation.
- **FR-6 (event):** When a new inbound OTA reservation is processed, map its room type, resolve/create the guest via 04, and create the booking via `03.createFromChannel(...)` with the mapped `BookingSource` + `channelRef`, consuming the **same availability truth** as direct bookings.
- **FR-7 (unwanted):** If an inbound room type has no `RoomTypeMapping`, then do not create a reservation; dead-letter the inbox row with `MAPPING_MISSING` and alert an administrator.
- **FR-8 (event):** When an inbound **modification** for a known `channelRef` is received, apply it via `03.modifyReservation(...)`; when a **cancellation** is received, apply it via `03.cancelReservation(...)`, releasing inventory.
- **FR-9 (event):** When availability changes (`ReservationCreated`/`Modified`/`Cancelled`, `RoomStatusChanged` block), recompute availability for the affected category/date range and `pushAvailability` to every active channel account mapped to that category.
- **FR-10 (event):** When an applied rate changes for a category/date (RatePlan edit or a `DynamicRateApproved` event from 24), `pushRates` to every active channel account mapped to that category.
- **FR-11 (ubiquitous):** **One availability truth** — OTA-sourced allocations occupy the same `RoomAllocation` inventory as direct; cross-channel overbooking is prevented by the same DB exclusion constraint in 03, never by a separate channel-side ledger (`business-rules.md` §3).
- **FR-12 (unwanted):** If a channel pushes a reservation for a category with no room actually free (oversell from sync lag), then still ingest it — `03.createFromChannel` returns `needsAttention='OVERSELL'` (never drops the paid booking) — and **persist that state as a `ChannelSyncLog` row with `status='NEEDS_ATTENTION'`** (which backs the needs-attention queue and health counts; no separate flag or channel-side ledger), alert reception with `CHANNEL_OVERSELL`, emit `ChannelOversellDetected`, and immediately re-push corrected availability.
- **FR-13 (event):** When a channel push or pull fails, retry with exponential backoff via pg-boss; after the max attempts, dead-letter the item and alert an administrator; **front-desk operations are never blocked** by a channel failure.
- **FR-14 (unwanted):** If an inbound webhook signature is missing/invalid, then reject it with `SIGNATURE_INVALID` and take no side effects (no inbox row, no reservation).
- **FR-15 (event):** When an inbound reservation is successfully created, emit `ChannelReservationPulled` (`externalId → reservationId`), write audit, and `ack` the channel so it is not re-sent.
- **FR-16 (ubiquitous):** Every channel mutation (connect, map, activate, process inbox) is property-scoped, authorized server-side (config requires `integration:manage`), audited, and — where it changes state — emits its domain event.
- **FR-17 (unwanted):** If an administrator attempts to activate a channel to live without the required certification/credential config, then reject with `CHANNEL_NOT_CERTIFIED` and keep it in sandbox.
- **FR-18 (state):** While a channel account is sandbox/inactive, outbound pushes are logged to the outbox but sent to no real OTA, and inbound pulls come only from the mock adapter.
- **FR-19 (ubiquitous):** Record `lastSyncAt` per channel account and expose a per-channel health view (connected state, last sync, pending and dead-lettered item counts).

## Non-functional (cited)
Integration failures degrade gracefully (retry/backoff/dead-letter) and never block the front desk; inbound events processed exactly once (inbox dedupe on provider id); inbound webhooks signature-verified before processing; availability recompute + push enqueued within the common-mutation budget (server confirm p95 < 800ms for the local write; the outbound network call is async via pg-boss); live occupancy updates within 2s (`non-functional-requirements.md`, `integrations.md` "Reliability").

## Business rules referenced
`business-rules.md` §1–2 (availability from confirmed/in-house + blocks; serializable/exclusion enforcement), §3 (OTA consumes the same inventory as direct — one truth), §19 (reservation lifecycle for inbound modify/cancel), §20 (validate → authorize → transaction → event → audit on every mutation). `integrations.md` (sandbox↔live gating; `ChannelManager` contract; idempotent, retried, signature-verified; inbox/outbox patterns; OTA certification is a client blocker).
