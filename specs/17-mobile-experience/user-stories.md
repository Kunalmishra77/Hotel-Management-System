# 17 · Mobile Experience — User Stories & Acceptance Criteria

Cross-cutting substrate. Verified on a mobile viewport.

## Test Fixtures
| Ref | Value |
|---|---|
| DEVICE | mid-range phone, 375px, 4G (Playwright emulation) |
| NET | online/offline toggle |
| U-HK | HOUSEKEEPING user (primary offline consumer) |

## US-1 — Install & load
- **AC-1:** Given a supported browser, when the user visits, then a valid manifest + service worker enable an **install** prompt; installed, it launches standalone. (FR-1)
- **AC-2:** Given a warm cache, when the app reloads, then the shell renders < 1s and works with intermittent connectivity. (FR-2)

## US-2 — Offline reads & queued writes
- **AC-3:** Given NET offline, when U-HK opens the housekeeping board, then cached data renders and a write (mark clean) is **queued** with optimistic UI. (FR-3)
- **AC-4:** Given NET returns, when background sync runs, then queued writes post to their server actions in order and each item shows success/conflict. (FR-4)
- **AC-5:** Given a queued write the server permanently rejects (illegal transition), when synced, then the failure is surfaced and the item is dropped without corrupting local state. (FR-8)

## US-3 — Realtime
- **AC-6:** Given two devices on the same property, when a room status changes on one, then the other receives the SSE update < 2s, scoped to permission/property. (FR-5)

- **AC-9 (negative):** Given a subscriber scoped to PROP-A, when an event for PROP-B occurs **or** an event whose payload carries guest PII is published, then the `/api/realtime` filter **does not** deliver it to that subscriber — no out-of-scope event and no PII-bearing field ever reaches the SSE stream. (FR-5)

## US-4 — Baseline
- **AC-7:** Given any screen at 375px, then layout is responsive, touch targets ≥44px, inputs use correct modes, and AA contrast holds. (FR-7)
- **AC-8:** Given connectivity changes, then the status indicator shows online/offline + pending-sync count + last-synced. (FR-6)
