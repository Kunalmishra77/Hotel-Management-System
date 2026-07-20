# 17 · Mobile Experience (PWA) — Requirements

> Source: client doc §16. Read with `rules/mobile-first.md`, `rules/non-functional-requirements.md`, `docs/architecture/adr/0004-pwa-not-native.md`. Cross-cutting substrate other modules build on. Depth bar: `specs/03-reservations/*`.

## Purpose & scope
Deliver the installable, offline-capable, cross-device Progressive Web App that satisfies "works on Windows/Android/iPhone/tablet, data syncs instantly" (§16) with one codebase — plus the realtime sync channel and the offline queue that housekeeping (10) and other modules use.

**In scope:** PWA manifest + service worker; install prompt; app-shell caching; **offline read cache + write queue** with background sync; realtime sync via Postgres `LISTEN/NOTIFY` → SSE; responsive/touch/accessibility baseline; connectivity + sync-status UI.
**Out of scope:** module-specific offline logic (each module defines what it queues — 10 housekeeping is the primary consumer); the auth/app-shell scaffold (00 provides the hook this module fills in); native app stores (ADR-0004).

## Dependencies
- **Tier 0:** 00-platform (app-shell hook, session, events/SSE source).
- **Consumed by:** all UI modules (responsive substrate), 10-housekeeping (offline queue), 01/02/14 (realtime tiles/boards).

## Data owned
None server-side (client-side IndexedDB queue). **Schema notes:** none; a generic `OfflineMutation` client store shape defined in design.

## Functional requirements (EARS)
- **FR-1 (ubiquitous):** Ship a valid PWA manifest + icons and a service worker so the app is **installable** on Android/iOS/Windows/tablet from the browser.
- **FR-2 (ubiquitous):** Cache the app shell + static assets for fast repeat loads and basic offline availability (`non-functional-requirements.md` warm-load budget).
- **FR-3 (state):** While offline, allow reads from a local cache and **queue writes** (a generic offline-mutation queue in IndexedDB) with an optimistic UI.
- **FR-4 (event):** When connectivity returns, **background-sync** the queued writes to their server actions in order; surface success/conflict per item (module-specific resolvers, e.g. 10).
- **FR-5 (event):** When a relevant server event occurs, push it to subscribed clients via `LISTEN/NOTIFY`→SSE within **2s**, scoped to the client's permissions/property (the realtime channel 01/02/14 consume). The `/api/realtime` server-side filter **must never** forward an event outside the subscriber's property scope/permissions, and **must not** include PII-bearing payload fields — the SSE stream carries only in-scope, non-PII event data.
- **FR-6 (ubiquitous):** Provide a connectivity + sync-status indicator (online/offline, pending-sync count, last-synced).
- **FR-7 (ubiquitous):** Meet the mobile-first baseline: responsive from 375px, touch targets ≥44px, WCAG AA, correct input modes — enforced as a shared component/lint baseline other modules inherit.
- **FR-8 (unwanted):** If a queued mutation fails permanently (server rejects, e.g. illegal transition), surface it to the user and drop it from the queue without corrupting local state.

## Non-functional (cited)
First meaningful interaction < 2.5s cold / < 1s warm on a mid-range phone/4G; realtime latency < 2s; offline queue flushes within seconds of reconnect. (`non-functional-requirements.md`)

## Business rules referenced
`business-rules.md` §21 (client never diverges from server truth — offline is optimistic, server reconciles); `mobile-first.md` (the whole rule).
