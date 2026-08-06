# Spec — Folio-authoritative billing + Check-in/out (Workstream 3C)

Status: **DRAFT — awaiting approval before implementation** (prime directive: no code
before an approved spec, especially on a money path). Owners: 03-reservations, 06-billing.

## 1. Problem

Today the reservation carries a **money snapshot** (`ratePaise/discountPaise/taxPaise/
advancePaise`) AND a **folio** exists in parallel. They track money incompatibly:

- `createReservation` creates an **empty** folio (`ensureFolio`); it posts no room charge
  and no payment.
- Room charges accrue **only at night audit** (`postRoomCharges`, idempotent per
  `(folioId, businessDate)`).
- The **advance** is a snapshot field, never a folio `Payment`.
- The **check-out gate** reads the snapshot (`priceReservation(...).balancePaise`), so
  POS/mini-bar/laundry charges on the folio do **not** gate check-out, and a same-day
  book→check-in→check-out has an empty folio.

No one-line reconciliation of snapshot↔folio is safe (MAX/MIN/sum each mis-gate a real
case). And the **MoM payment-states** (Unpaid-online / Already-paid / Pay-at-hotel) reshape
the money model. Therefore the folio must become the **single source of truth**.

## 2. Target invariant (business-rules.md §5–8)

> Every in-house reservation has exactly one folio. **All** charges (room, POS, laundry,
> extras) and **all** payments (advance, at-desk, online) post to the folio as immutable
> lines. Balance is **derived** from the folio. Check-out gates on the **live folio
> balance**. The reservation snapshot becomes a booking-time estimate only, never the
> money truth.

## 3. Payment states (MoM)

New enum `SettlementIntent` on the reservation, captured at booking:

| State | Meaning | Folio effect |
|---|---|---|
| `PAY_AT_HOTEL` (default) | Collect at the desk | No upfront payment; balance due at check-out |
| `ALREADY_PAID` | Paid before arrival (OTA/direct) | Post a folio `Payment` for the amount at booking |
| `UNPAID_ONLINE` | Awaiting a payment link (HDFC/WhatsApp) | A pending intent; a folio `Payment` posts **only** on gateway confirmation — never auto-collected (MoM) |

The legacy `advancePaise` is migrated to a folio `Payment` (mode as recorded) — the snapshot
field is retained read-only for historical bookings.

## 4. Data & helper changes

- **Enum** `SettlementIntent` (Prisma) + `Reservation.settlementIntent` (default `PAY_AT_HOTEL`) — additive migration.
- **Tx-composable billing helpers** (current billing actions are standalone `"use server"`
  with their own auth/tx and cannot compose): add internal, transaction-level
  `postRoomChargeTx(tx, {folioId, propertyId, nights…})` and `postPaymentTx(tx, {folioId,
  mode, amountPaise, reference})`, sharing the domain (`computeGst`, append-only guards) and
  the `(folioId, businessDate) WHERE type='ROOM'` idempotency of night audit.
- **No schema change to Folio/FolioLine/Payment** — they already model this.

## 5. Flows

- **Booking** — create reservation + folio; capture `settlementIntent`; if `ALREADY_PAID`,
  `postPaymentTx` the amount.
- **Check-in** — ensure folio; if a booking advance exists and is not yet a folio payment,
  `postPaymentTx` it. (ID capture → §6.)
- **Night audit** — unchanged (accrues room-night charges).
- **Check-out** — within the transaction: `postRoomChargeTx` for any **un-accrued** nights
  of the stay (idempotent vs night audit) → compute **live folio balance** → gate on it
  (defer needs `folio:defer` 🔒) → take final split payment → generate GST invoice →
  capture feedback → rooms → HOUSEKEEPING.

## 6. Check-in wizard (UI)

Replace the one-click board button with a guided flow: verify booking → **Aadhaar
(mandatory, MoM)** + PAN/Passport capture (reuse `guests.addGuestId` + encrypted storage) →
**FRRO / C-Form I & II** for foreign guests on passport upload (Document AI; manual fallback)
→ e-signature + digital registration card → payment per `settlementIntent` → issue key/card
→ welcome message → done. Also enables **"book & check-in now"** from the walk-in wizard.

## 7. Integrations (flagged, not blocking core)

HDFC pay-link + WhatsApp confirm/24h-reminder (MoM). Core money model must work in sandbox
first; live wiring is a config step once credentials land.

## 8. Tasks (ordered; each traceable)

1. **T1** — `postRoomChargeTx` + `postPaymentTx` tx-composable helpers + unit tests (GST split, idempotency, append-only).
2. **T2** — `SettlementIntent` enum + `Reservation.settlementIntent` migration (additive).
3. **T3** — booking captures intent; `ALREADY_PAID` posts a folio payment.
4. **T4** — check-in posts the advance as a folio payment.
5. **T5** — **check-out**: post remaining room charges → gate on live folio balance → final split payment → GST invoice → feedback. *(The critical money task; most tests.)*
6. **T6** — check-in wizard UI (ID/Aadhaar, signature, key, welcome) + "book & check-in now".
7. **T7** — FRRO / C-Form generation for foreign guests.
8. **T8** — HDFC pay-link + WhatsApp automations (needs credentials).

## 9. Test plan (testing-strategy.md — non-negotiable money paths)

- Unit: room-charge GST split; folio balance derivation; idempotent room-posting (night
  audit vs checkout — never double-posts a night); payment-state → folio mapping.
- Integration: book(ALREADY_PAID)→checkin→checkout with folio balance 0 passes; book(PAY_AT_HOTEL)
  →checkin→POS charge→checkout is **gated** until settled; `folio:defer` override audited;
  gap-free GST invoice at checkout.
- E2E: walk-in → book & check-in now → add POS charge → settle → check-out → invoice → feedback.
- Regression: existing `reservations.spec` journey stays green.

## 10. Risks

- **Double-posting room charges** (night audit + checkout) — mitigated by the shared
  `(folioId, businessDate)` idempotency key.
- **Historical bookings** with snapshot advance but no folio payment — handled by T4 posting
  on check-in; already-checked-out historical rows are read-only and unaffected.
- **Money correctness is the bar** — T5 does not merge without the integration tests in §9 green.
