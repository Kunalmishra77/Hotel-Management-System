# /review-module — 13-booking-channel-integrations

**Date:** 2026-08-03 · **Reviewer:** implementing engineer (self-review, per DoD § Review)
**Built by:** delegated subagent (parallel Tier-5 batch); **integrated + verified serially by the parent.**
**Depends on:** 03 (`createFromChannel`) · 24 (`DynamicRateApproved` event) · 00 (inbox/outbox/events/alerts).
**Tier 5.** Owns `ChannelAccount`, `RoomTypeMapping`, `ChannelSyncLog`.

## 1. Traceability — AC → test
**19 unit** + **~13 integration** + **1 e2e**.

| AC | Requirement | Covered by |
|---|---|---|
| AC-1/2/16 | Connect + map room type + RBAC | integration · e2e |
| AC-2/6 | `mapRoomType` incl. missing mapping | `map-room-type` unit · integration (dead-letter) |
| AC-3 | `activateChannel` certification gate | integration (`CHANNEL_NOT_CERTIFIED`) |
| AC-4 | Inbound → create via 03, source+channelRef, same availability | integration |
| AC-5 | Inbound dedupe (re-delivery → no duplicate) | integration (process + webhook) |
| AC-7 | Inbound modify/cancel | integration |
| AC-8 | `ChannelReservationPulled` + audit + ack | integration |
| AC-9/10/11 | Outbound push on availability + `DynamicRateApproved` (sandbox=outbox) | integration · `availability-delta` unit |
| AC-12 | Oversell → NEEDS_ATTENTION + `CHANNEL_OVERSELL` alert + `ChannelOversellDetected` + re-push, never dropped | integration |
| AC-13 | Retry/backoff → dead-letter; front desk unblocked | integration · `retry` unit |
| AC-14 | Invalid signature → no side effects | integration |
| AC-15 | Channels health view | integration · e2e |
| FR-11 | One availability truth: OTA + direct can't overbook a room | integration |

## 2. Invariants
| Invariant | Status |
|---|---|
| One availability truth | ✅ inbound creates via 03 (`room_no_overlap`); OTA + direct share inventory |
| Provider behind interface, mock default | ✅ `lib/channels` `ChannelManager` + `MockChannelManager`; live refuses uncertified pushes (honest per-OTA blocker) |
| Reliability | ✅ inbound deduped in inbox; outbound rides 00's outbox dispatcher (retry/backoff/dead-letter + alert) |
| Oversell never dropped | ✅ NEEDS_ATTENTION queue + alert + event + re-push |
| Signature-verify-first | ✅ invalid signature → no side effects |

## Decisions
- **D-1** Inbound modify/cancel run under worker/system context (03's `modify/cancelReservation` are user-gated), so `inbound-lifecycle.ts` applies the change + emits 03's `ReservationModified`/`ReservationCancelled` + audit. Cleaner follow-up: add `modifyFromChannel`/`cancelFromChannel` to 03's channel surface.
- **D-2** `process-inbox` worker job now routes 13's channel handlers (it was a no-op before; 06/12 handle their webhooks inline).
- **D-3** Outbound pushes recompute from current state (idempotent) on each event; `ChannelSyncLog` has no payload column, so OUT rows carry the target categoryId in `externalId` (documented).

## Carried risks
- **R-31** 24's `DynamicRateApproved` payload is consumed defensively (reads `propertyId/categoryId/from/to/ratePaise`, skips if unresolvable) — confirmed 24 emits these.
- **R-32** `resolveOrCreateGuest` deep-imports 04's storage helpers (04 exposes no system-context guest create) — a system-safe 04 resolve would remove the deep import.
- **R-33** Live OTA (Booking/Agoda/MMT/Goibibo/Airbnb) needs certified connectivity per OTA — no code bypass; mock covers every path (integrations.md).
