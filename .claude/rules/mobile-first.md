# Mobile-First

The primary device is a **phone in the hand of reception/housekeeping staff**. Design for that first; scale up to tablet/laptop.

## Rules
- **Base styles target the smallest viewport.** Use Tailwind breakpoints to enhance upward, never to fix a desktop-first layout downward.
- **Touch targets ≥ 44px**; primary actions reachable with a thumb; avoid hover-only affordances.
- Forms optimised for speed: correct input modes (`inputmode`, `type=tel/email/number`), minimal typing, sensible defaults, one-thumb reservation and check-in.
- Tables collapse to cards on small screens (`components/mobile`).

## PWA (§16 — "works on Windows/Android/iPhone/tablet, data syncs instantly")
- Installable PWA (manifest + service worker). One codebase covers all four devices — no native apps in scope.
- **Offline-capable where it matters:** housekeeping room-status updates and basic lookups queue offline and sync when connectivity returns (background sync). Conflict resolution: last-writer-wins on status with server timestamp, surfaced to user.
- **Instant sync / live occupancy:** Postgres `LISTEN/NOTIFY` → SSE keeps dashboards and room boards current across devices without refresh.

## Performance on mobile networks
- Route-level code splitting; server components by default; ship minimal JS.
- Optimistic UI on fast, common actions (status change, add charge) with server reconciliation.
- Meet the mobile budgets in `non-functional-requirements.md`.

## Accessibility
- WCAG AA contrast; semantic HTML; keyboard + screen-reader support; visible focus. Radix/shadcn primitives give us accessible defaults — don't undo them.
