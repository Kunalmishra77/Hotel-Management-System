# 17 · Mobile Experience — Tasks

Cross-cutting substrate. Verify on mobile viewport. Each ends at `rules/definition-of-done.md`. `(AC-n)/(FR-n)`.

## PWA shell
- [ ] T-1 Manifest + icons + install (A2HS); standalone launch. (FR-1, AC-1)
- [ ] T-2 Service worker: precache shell + runtime SWR cache; warm load < 1s. (FR-2, AC-2)

## Offline queue
- [ ] T-3 `lib/offline` IndexedDB queue: enqueue/flush + per-action resolver hook. (FR-3/4)
- [ ] T-4 Background Sync flush on reconnect, in order; success/conflict per item. (FR-4, AC-4)
- [ ] T-5 Permanent-reject handling (drop, surface, no corruption). (FR-8, AC-5)

## Realtime
- [ ] T-6 `/api/realtime` SSE from Postgres LISTEN/NOTIFY, permission/property-filtered. (FR-5, AC-6)
- [ ] T-6b Negative filter test: an out-of-scope (other-property) or PII-bearing event is **never** delivered to a subscriber. (FR-5, AC-9)
- [ ] T-7 SSE client with backoff reconnect. (FR-5)

## Baseline components
- [ ] T-8 `<ConnectivityBadge/>` + `<SyncStatus/>`. (FR-6, AC-8)
- [ ] T-9 Mobile baseline primitives (44px, inputmode, AA) + lint rule for base-first breakpoints. (FR-7, AC-7)

## E2E (mobile viewport)
- [ ] T-10 Install + warm load budget. (AC-1/2)
- [ ] T-11 Offline queue → reconnect sync (with 10 housekeeping). (AC-3/4/5)
- [ ] T-12 Two-device realtime < 2s. (AC-6)
- [ ] T-13 Accessibility/responsive audit at 375px. (AC-7)

## Done
- [ ] T-14 `/review-module` clean; budgets met on emulated mid-range phone; every AC → green test; DoD satisfied.
