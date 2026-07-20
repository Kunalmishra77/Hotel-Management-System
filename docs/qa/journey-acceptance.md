# End-to-End Journey Acceptance (epics) + NFR Acceptance

Per-module `user-stories.md` pin **within-module** behavior. This doc pins the **cross-module journeys** — the integration-level acceptance a per-module story can't express — and turns the **NFR budgets** into explicit, measured acceptance. Each journey is an **E2E test** (Playwright/integration on the seeded dataset, mobile viewport) that spans several modules. Runs in CI as the release gate ([development-process.md](../workflows/development-process.md)).

## Journeys (Given/When/Then across modules)

### J1 · Direct booking → stay → GST invoice → night audit *(03·02·06·14·12)*
- **Given** a vacant Deluxe and a guest, **when** Reception books → checks in → adds an F&B charge → takes a split payment → generates the GST invoice, **then** the room goes RESERVED→OCCUPIED, one folio holds all lines append-only, the invoice is gap-free with correct **CGST+SGST** (property-location place-of-supply), and the balance derives to the paisa.
- **And when** night audit runs for the business date, **then** the room-night charge posts idempotently, the day snapshots (occupancy/ADR/RevPAR), the business date rolls and locks, and a positive balance emits `PaymentDueDetected` → 12 reminder.

### J2 · OTA inbound → folio → checkout (one availability truth) *(13·03·04·06)*
- **Given** a certified/sandbox channel, **when** an OTA reservation is pulled, **then** it dedupes on `(provider, externalId)`, resolves/creates the guest, and creates the booking via `03.createFromChannel` onto the **same `RoomAllocation`** as direct — a concurrent direct booking of the last room cannot overbook it (DB exclusion constraint).

### J3 · Public web booking → pay → confirm → coupon *(23·04·03·06·24·25·12)*
- **Given** the public site, **when** a guest searches, applies coupon `SAVE10`, and pays the deposit, **then** the GST-inclusive total (from `RoomCategory.gstBps`, negotiated/dynamic rate resolved) reduces by the previewed coupon, the payment webhook (signature-verified, inbox-deduped) confirms the hold in **one transaction** (confirm + advance + **atomic coupon redeem** + `WebBookingConfirmed`), and an abandoned checkout redeems nothing and releases the hold.

### J4 · Night-audit close & report consistency *(14·06·03·08)*
- **Given** in-house folios and a business date, **when** night audit completes, **then** the immutable `DailyStatSnapshot` is written, and the **08 profit report for that closed date equals the live dashboard to the paisa** (revenue net-of-discount tax-excluded; expenses = 07 approved + apportioned payroll, counted once). A re-run is a no-op; a mid-run failure leaves the date unchanged and is safely re-runnable.

### J5 · Payroll run → profit *(09·21·08·22)*
- **Given** a month of staff attendance, **when** payroll is generated → adjusted → finalized, **then** base/OT/net compute correctly (UNPAID leave = LOP, `paidDays` capped), payslips render, and `PayrollFinalized` flows to 08 (staff cost counted once) and 22 (salary journal). A finalized run is immutable; corrections are a separate audited adjustment run.

### J6 · Go-live import → live data *(26·04·03·06·05·14)*
- **Given** an admin's guest/booking/balance spreadsheets, **when** they upload → **dry-run validate** (see errors/dupes, no writes) → fix → **commit**, **then** guests are created via `04.upsertGuest` (dedup), historical bookings via 03 (populating 05 history), opening balances via 06 (real outstanding) — and **re-importing the same file is a no-op** (idempotent). A committed batch is reversible via `ImportRow.targetId`.

### J7 · Housekeeping offline → sync *(10·17·02·01·14)*
- **Given** a housekeeper on weak Wi-Fi, **when** they mark a room clean **offline** and connectivity returns, **then** the queued write syncs, the room goes HOUSEKEEPING→VACANT (02 transition-validated), and the property board + dashboard update via SSE **< 2s** — a **stale** offline write (older than `serverStatusChangedAt`) is rejected and surfaced, never overwriting a re-occupation.

### J8 · Corporate booking → credit settle → statement *(25·03·06)*
- **Given** ACME with a negotiated rate and credit limit, **when** an ACME booking resolves the negotiated rate, checks out, and settles on `CORPORATE_CREDIT`, **then** `reserveCredit` atomically checks-and-increments the receivable under a row lock (two concurrent near-limit settlements can't both pass), and the corporate statement shows charges/payments/aging reconciled with the folios.

## NFR acceptance (budgets are tests, not prose)
Verified on the seeded **scale dataset** (100k+ guests / 1M+ folio lines) with an injected clock; CI-gated where feasible; a regression blocks merge.

| Budget | Asserted in | Where the per-module AC lives |
|---|---|---|
| Availability search **p95 < 500ms** | J1/J2 | 03 AC-9 |
| Cross-entity search **p95 < 500ms** | J6 + search flows | 15 AC-1 |
| GST invoice action + PDF render **< 3s**; open→generate→present **< 60s** staff time | J1 | 06 (invoice) — asserted here as the E2E timing gate |
| Common mutation server-confirm **p95 < 800ms** | J1/J3/J8 | across billing/reservation ACs |
| Realtime (event→screen) **< 2s** | J1/J7 | 01 AC-7, 17 AC-6 |
| No overbooking under concurrency (correctness = 100%) | J2/J3 | 03 AC-5/6, 23 no-overbooking |
| Daily backup success ≥ 99% + drilled restore | ops | 16 backup + restore-test |
| Integration failure degrades gracefully (retry→dead-letter), front desk never blocked | J2/J3, 22 | 12/13/22 reliability ACs |

## Rule
Every journey here maps to a named E2E test; the NFR rows map to timed/asserted tests on the scale seed. A module's own `tasks.md` E2E task references its slice of these journeys. Green journeys + green NFR asserts are part of the release Definition of Done.
