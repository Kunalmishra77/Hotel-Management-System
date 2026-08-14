# Phase 5 — Clickable KPIs + reception depth

> Part of the customer-first redesign. Today's dashboards show numbers you can't
> touch. Phase 5 makes the KPI a **door**: click "Arrivals today · 5" and land on
> those five bookings with Check-in buttons. The primitive is reusable, then
> retrofitted across the dashboards.

## What already exists (reused)

- `KpiCard` (the dashboard workhorse) + `ReservationBoard` (arrivals / in-house /
  departures sections with inline Check-in/Check-out). The records + actions are
  already there — they're just not reachable *from* the number.

## Design

1. **`KpiCard` gains an optional `href`.** When set, the whole card becomes a Link
   with a hover-lift + a small affordance; keyboard-focusable. No `href` = today's
   static card, unchanged. One primitive change unlocks every dashboard.
2. **`ReservationBoard` gains a `view` filter** (`arrivals | in-house | departures
   | all`). The bookings page reads `?view=` and renders only that segment — a
   focused, actionable list — with a "clear filter" affordance back to all.
3. **Wire the KPIs.** Bookings: Arrivals/Departures/In-house KPIs →
   `/bookings?view=…`. Then retrofit `href`s onto KPIs elsewhere where a filtered
   destination already exists (billing outstanding, the reception operational
   tiles, the command-centre per-hotel drill-in).

## Tasks

- [ ] **T-1 — `KpiCard` clickable.** Optional `href`; Link wrapper + `.u-lift`
   hover + focus ring; unchanged when absent.
- [ ] **T-2 — Bookings filtered board.** `ReservationBoard` `view` prop; bookings
   page `?view=` (validated) → filtered board + clear-filter chip; the three
   operational KPIs become links.
- [ ] **T-3 — Retrofit.** Add `href`s to KPIs on the billing landing (outstanding),
   the reception `/dashboard` operational tiles, and the command-centre where a
   filtered/drill destination exists. Only where the target list already exists.
- [ ] **T-4 — Verify.** Unit (the `?view=` param validator is pure) + typecheck +
   lint + build; KPIs render as links with correct hrefs.

## DoD

- A `KpiCard` with `href` is a real link (anchor), keyboard-focusable, hover-lift;
  without `href` it's byte-for-byte today's card.
- `?view=` is validated to the known set (bad value → all, never an error).
- No permission/scope change — these are navigation affordances over existing,
  already-authorized lists.

## Out of scope (later)

- New inline actions beyond what the board/folio already offer; per-KPI deep-filter
  query DSLs. Phase 6 owns approvals + the Super-Admin aggregate dashboard.
