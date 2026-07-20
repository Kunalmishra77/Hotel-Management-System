# Business Rules (Domain Invariants)

These are invariants — always true, enforced in the domain layer and in DB constraints. Violating one is a bug regardless of tests.

## Availability & booking (no overbooking, ever)
1. A room cannot be double-allocated for overlapping date ranges. Enforced in a **serializable/locking transaction** at reservation and check-in, plus a DB exclusion constraint on (room, date-range).
2. Availability is computed from confirmed + in-house reservations and blocks (maintenance/housekeeping holds). Cancelled/no-show do not consume inventory.
3. OTA-sourced bookings consume the same inventory as direct — one availability truth (`13-booking-channel-integrations`).
4. Nights = `checkOut.date − checkIn.date` in **property-local** days (min 1 for day-use if enabled).

## Folio & billing (money never drifts)
5. Every in-house reservation has exactly one **folio**. All charges (room, food, laundry, transfer, taxi, extra bed, POS, misc) and all payments post to the folio as immutable line items.
6. **Balance = Σ charges + Σ taxes − Σ payments − Σ discounts.** Never stored as an editable field; always derived.
7. Charges/payments are **append-only**. Corrections are reversing entries (never edit/delete a posted line). Full audit trail.
8. **Money = integer minor units (paise)** — **`BigInt` for accumulating totals** (folio lines, payments, invoices, receivables, credit limits, snapshot totals), `Int` only for small bounded values (per-unit rates, tax components); see `data-model.md`. All arithmetic via Decimal.js; round half-up to the paisa at line level, per GST rules.
9. Advance received reduces balance; balance due is shown at checkout and drives payment reminders.

## GST (India tax correctness)
10. GST is computed per line by HSN/SAC and applicable rate. Intra-state → CGST+SGST (split equally); inter-state → IGST — determined by property state vs place-of-supply. **For accommodation and all on-premise / point-of-consumption services (room, food, laundry, airport-transfer, taxi, kitchen, extra-bed, POS), place-of-supply = the PROPERTY's state (IGST Act §12) — so these are ALWAYS CGST+SGST, regardless of the guest's billing/home state.** IGST applies only to a genuinely inter-state supply where place-of-supply law dictates it (rare here). Every GST-computing module (06 billing, 19 POS, 23 booking-engine) follows this — never derive GST type from the customer's bill-to state for on-premise supplies.
11. Room tariff GST slab follows declared tariff bands (rate depends on per-night tariff). Config-driven, not hard-coded.
12. A **GST tax invoice** carries: invoice no. (sequential, gap-free, per property/financial year), GSTIN (property + customer if B2B), HSN/SAC, taxable value, tax breakup, total in words.
13. Invoice numbering is gap-free and never reused; issuance is transactional.

## Night audit (the daily close)
14. A nightly **night-audit** run per property: posts room-night charges for in-house guests, rolls the business date, flags no-shows, snapshots occupancy/ADR/RevPAR for the day, and locks the closed day against back-dated edits (except via audited adjustment).
15. Reports for a closed business date are immutable snapshots; live dashboards read current state.

## Guest & CRM
16. A guest is a permanent record; reservations reference guests. Duplicate detection on phone/email/ID before creating a new guest.
17. Guest history (visits, room-nights, revenue, outstanding, preferences) is **derived** from reservations/folios, not hand-maintained.

## Status & lifecycle
18. Room status ∈ {Vacant, Occupied, Reserved, Under-Maintenance, Housekeeping}. Transitions are validated (e.g. can't check in to Under-Maintenance).
19. Reservation status lifecycle: Enquiry → Confirmed → In-House → Checked-Out → (Cancelled/No-Show as terminal branches). Illegal transitions rejected.

## Cross-cutting
20. Every mutation: validate → authorize → transaction → emit domain event → write audit record. No exceptions.
21. All amounts, dates, and statuses shown to users match the folio/DB exactly — no client-side recomputation that can diverge.
