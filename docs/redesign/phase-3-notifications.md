# Phase 3 — Booking → hotel bridge + notifications

> Part of the customer-first redesign. When a guest books online, the hotel should
> *know* — not just find the row later. Online bookings already land in Reception's
> board (WEBSITE reservations); this phase adds the **notification** layer: a bell +
> inbox that alerts the right staff in near-real-time, driven by domain events.

## What already exists (reused, not rebuilt)

- **Domain-events backbone** — every mutation emits an event to the outbox;
  `dispatchOutbox` delivers to registered consumers (comms, accounting, AI…).
  Notifications become **one more consumer** — the write path is never touched.
- **Fast desk search** — the ⌘K command palette already live-searches guests &
  bookings (scoped); `/search` exists. Phase 3 verifies coverage (name/phone/email/
  date); no rebuild unless a gap is found.

## The gap this closes

- No **`Notification`** table and no bell. Staff have no push signal for a new
  online booking.
- **Events only dispatch via the worker** (`scripts/worker.ts`). In a single-process
  deploy (Coolify running `next start` only), the worker isn't running, so *no*
  consumer fires — comms and notifications alike are silent. Phase 3 adds an
  **in-process outbox tick** (`tickOutboxOnce`) that runs from a Node server action
  — the notification bell polls one every ~20s while staff are active — so the
  event backbone actually runs in the deployed app with no separate worker.
  (Instrumentation was avoided: its module is also compiled for the Edge runtime,
  which can't bundle the consumers' `node:crypto` imports.) Opt out with
  `IN_PROCESS_OUTBOX=false` when a dedicated worker is deployed.

## Design

**`Notification` (new, per-recipient rows).**
`orgId`, `propertyId?`, `recipientUserId`, `type`, `title`, `body?`, `link?`,
`entityType?`, `entityId?`, `eventId?`, `readAt?`, `createdAt`. Unique
`(eventId, recipientUserId)` makes consumer retries idempotent; index
`(recipientUserId, readAt)` for the unread query.

**Targeting.** For `ReservationCreated` with `payload.source === "WEBSITE"`,
resolve recipients = users who hold `reservation:view` **scoped to that property**:
roles from `PERMISSION_MATRIX["reservation:view"]`, then `RoleAssignment` where the
role is org-wide (ADMINISTRATOR) or `propertyIds has propertyId`, filtered to active
users. One Notification row per recipient, linking to `/bookings/{id}`.

**Delivery to the bell.** The bell reads the viewer's own unread notifications
(scoped by `recipientUserId`) and refetches on a light interval (TanStack Query
`refetchInterval`). SSE push is a later enhancement — polling is simple, correct,
and PII-safe (the bell only ever reads the viewer's own rows).

## Tasks

- [ ] **T-1 — model + migration** (additive; `Notification` + `User.notifications`).
- [ ] **T-2 — notifications feature.** `consumer.ts` (target resolution + idempotent
  row creation for `ReservationCreated`/WEBSITE), `queries.ts`
  (`listMyNotifications`, `unreadCount` — scoped to the caller), `actions.ts`
  (`markNotificationRead`, `markAllNotificationsRead` — caller owns the row).
  Domain unit test for the pure target-resolution helper.
- [ ] **T-3 — dispatch wiring.** Extract `registerAllConsumers()` (shared by the
  worker + in-process), register the notifications consumer, add `tickOutboxOnce`
  (register-once + re-entrancy-guarded single dispatch pass) called from the bell's
  `fetchNotifications` server action (Node runtime).
- [ ] **T-4 — bell UI.** `NotificationBell` in the dashboard header: unread badge,
  popover inbox (title, time, link), mark-one / mark-all read, empty state.
- [ ] **T-5 — desk search check.** Confirm ⌘K/`/search` cover name/phone/email/date;
  add a date lookup only if missing.
- [ ] **T-6 — verify.** Unit + integration (consumer creates rows for the right
  users, idempotent on replay, IDOR: a user only reads their own) + typecheck +
  lint + build; run the guest-account integration on the local 5433 DB too.

## Security / DoD

- The bell only ever returns the caller's own rows (`recipientUserId = me`); no
  cross-user read, no PII beyond the booking title the recipient may already see.
- Consumer is idempotent (unique `(eventId, recipientUserId)` + dispatch dedupe).
- No secret/PII in logs. Mark-read authorizes on ownership.

## Out of scope (later)

- SSE live push for the bell (polling now). Notification preferences/mute.
- Guest-side notifications (their own booking updates) — a later customer-portal pass.
