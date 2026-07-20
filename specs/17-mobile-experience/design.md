# 17 · Mobile Experience — Design

## Schema slice
None server-side. Client store: `OfflineMutation { id, action, payload, clientUpdatedAt, status }` in IndexedDB.

## Client infrastructure (`src/lib` + `src/app`)
- **Manifest + icons** (`public/manifest.webmanifest`, `public/icons/`) + `<link rel=manifest>` in root layout.
- **Service worker** (`public/sw.js` or next-pwa): precache app shell + static; runtime cache for GET queries (stale-while-revalidate); Background Sync API for the write queue.
- **Offline queue** (`lib/offline`): `enqueue(action, payload)`, `flush()` on `online`/sync event; per-action **resolver** hook (module supplies conflict handling, e.g. 10 `resolveConflict`).
- **Realtime** (`lib/realtime`): SSE client to `/api/realtime` (server: Postgres `LISTEN/NOTIFY` fan-out, permission/property-filtered). Reconnect w/ backoff.

## Application — route handler (`src/app/api/realtime/route.ts`)
SSE stream: authenticate → subscribe to the user's property channel → forward **only** in-scope, permission-allowed domain events, stripping PII-bearing payload fields (deny-by-default filter). An out-of-scope or PII-bearing event is never emitted to the subscriber. (FR-5)

## Shared UI baseline (`src/components/mobile`, `ui`)
Responsive primitives, 44px touch targets, `inputmode` helpers, AA tokens, `<ConnectivityBadge/>`, `<SyncStatus/>`. Other modules inherit these (lint enforces base-first breakpoints).

## UI — wireframes
```
┌───────────────────────────┐
│ ● online · synced 2s ago  │  ← <ConnectivityBadge/> + <SyncStatus/>
│           …app…           │
│ ○ offline · 2 pending ⤴   │  ← offline state
└───────────────────────────┘
[Install app] prompt (A2HS)
```

## Events
Consumes: all domain events (as the SSE transport). Emits: none server-side. Catalog: `docs/architecture/domain-events.md`.

## Error catalog
`SYNC_CONFLICT` (surfaced), `SYNC_REJECTED` (drop item), `SSE_DISCONNECTED` (auto-reconnect).

## Edge cases
- iOS PWA limitations (push/background) — documented; core offline queue uses periodic + on-open flush as fallback where Background Sync is unavailable.
- Multiple tabs → single shared service worker; queue dedupes by mutation id.
- Clock skew → server timestamp authoritative for conflict resolution (aligns with 10).
- Large cache → eviction policy; never cache PII-heavy responses beyond need.
