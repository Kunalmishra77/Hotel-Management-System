# Phase 9 — A-Z Portal & Module Review (production-readiness backlog)

**Date:** 2026-09-05 · Companion to `2026-09-05-hms-production-readiness.md` (Phases 1-8 done).
This is the running backlog: known gaps, UX rough edges, and workflow holes across every
portal/module, prioritised. Work it top-down; each item becomes a small phase (build → test → review).

Priority: **P1** = correctness / blocks a core workflow · **P2** = important UX/feature · **P3** = polish.

## Flow-audit fix pass (2026-09-07) — DONE
A full nav/route/click audit found the app is well-wired (no dead routes); the confusion was behavioural. Fixed:
- ✅ `/rooms` no longer crashes with no active property (graceful `NoProperty` state).
- ✅ Admin/Manager can reach the **front-desk board** via `/bookings?desk=1` ("Front desk" button on the portfolio view) — check-in was hidden behind the role-branched route.
- ✅ Occupied/reserved rooms link to their **booking** (guest + folio) from the action sheet.
- ✅ Every per-property page (22) shows an actionable **NoProperty** empty state instead of a bare "Select a property" dead-end.
- Remaining (minor, visual — do with the client's eyes): P2-3 KPI click-affordance consistency, P3-1 direct-sale folio row cue.

---

## Cross-cutting (all portals)
- **P1 — Verify Phases 1-8 on live after redeploy.** Large unverified change set incl. a live DB migration (`ReservationGuest`). Drive each flow once on the deployed app before building further.
- **P2 — Reservation edit after check-in (dates/room).** `modifyReservation` is still gated to `CONFIRMED`; Phase 3-4 covered guest + occupancy, not date/room correction for an in-house stay. Add an audited in-house date/room amend.
- **P2 — Empty/loading/error states audit.** Confirm every list has a real empty state + skeleton; every server action surfaces a user-safe error toast.
- **P3 — Consistent page headers, breadcrumbs, and mobile bottom-nav across all portals.**

## Super-Admin
- **P2 — Billing for Super-Admin is property-scoped** (`activePropertyId`); add a portfolio billing rollup (dues/collections per property) mirroring the new Bookings section.
- **P2 — Bookings section: add drill-through** from a property row to that property's bookings, and a status/source/date filter on the recent-bookings feed.
- **P3 — Overview/Insights/Bookings share the period lens** — confirm the custom-range picker works end-to-end on all three.

## Reception (front desk)
- **P1 — Full booking→invoice journey e2e** on mobile viewport (create → check-in → add charges → discount → payment → checkout → auto-invoice). This is the money path; needs a green Playwright run.
- **P2 — Data Entry reachable from Reception** (currently Super-Admin only) — front desk is who enters walk-in / historical guests. Consider adding `data-entry` to the RECEPTION portal.
- **P2 — Reservation detail: surface accompanying guests + bill on the check-in wizard's confirm step** so the desk sees the whole picture before completing.
- **P3 — Keyboard-fast new-booking + one-thumb check-in** review.

## Accounts
- **P1 — Invoice PDF is plain-text** (`attachInvoicePdf` note, 06 review F-1) — replace with a styled `@react-pdf/renderer` GST invoice.
- **P2 — Backfill invoices for already-checked-out demo stays** (auto-invoice only fires on new checkouts); add a one-off "issue invoice" bulk action or accept forward-only.
- **P2 — Expense approval + payroll finalize flows** end-to-end review (profit = revenue − expenses − payroll; ensure no double count per `reporting.md`).

## Housekeeping
- **P2 — Offline room-status queue + sync** (mobile-first §16) — verify the offline write → `serverStatusChangedAt` conflict guard actually works on a flaky connection.
- **P3 — Linen/complaint capture UX** on phone.

## Maintenance
- **P2 — Preventive-maintenance reminders** (scheduled jobs) — confirm they fire and surface.
- **P3 — Asset ↔ maintenance-job linkage** review.

## Outlet (POS) & Store (Inventory)
- **P2 — POS → folio settle** path + guest QR self-order accept-gate end-to-end.
- **P2 — Add-on catalog HSN/tax override bug** (`add-ons/actions.ts:90`) — `decideAddOnRequest` posts without the catalog item's HSN/`taxRateBps`, so GST falls back to charge-type defaults. Fix by passing them to `postFolioCharge`.
- **P2 — Reception-initiated add-on** (today only guest-initiated) — a "+ Add-on" picker on the folio using the catalog.
- **P2 — Laundry linen reconciliation** (sent vs returned + tolerance) review.

## Owner portal
- **P2 — Payout statement + disbursement ledger** numbers reconcile with `reporting.md` (management-fee model).
- **P3 — Document vault two-way + schedule tracker** UX.

## Data & integrations
- **P2 — Import/Export hub: add Rooms & Services export** (not in the search index today — needs small dedicated export queries).
- **P2 — Vision AI provider** enablement for real photo-OCR in Data Entry (currently mock → manual). Client integration, gated like payments/WhatsApp.
- **P3 — Booking/bill photo → structured commit** (extends Phase 8 beyond guests once vision AI is on).

## Tech / quality
- **P1 — Coolify deploy does NOT run migrations.** Add `prisma migrate deploy` to the deploy/start step (or a documented manual step) so schema changes ship with code. (Phase-4 migration was applied manually.)
- **P2 — Integration test suite** connection-budget flakiness (see `testing-strategy.md`) — dedicated `.env.test` DB for a clean run.
- **P3 — `.env` `NODE_ENV` smell** + rotate dev passwords / secrets before real go-live.

---

### Suggested next sequence
1. Redeploy + verify Phases 1-8 (P1 cross-cutting).
2. Styled GST invoice PDF (Accounts P1).
3. Add-on HSN fix + reception add-on (Outlet P2).
4. Portfolio billing rollup (Super-Admin P2).
5. Migrate-on-deploy (Tech P1).
