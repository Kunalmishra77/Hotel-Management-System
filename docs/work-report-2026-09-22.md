# Woodpecker PMS — Work Report (22 Sep 2026)

**System:** hotelmanagement.aiagentixdev.com · **Deployed commit:** `c3a6ee1` (redeploy `main` to apply)

This report summarises the issues fixed and features added in response to the 10-point requirement list (plus one mid-work request: property-first New Booking).

---

## 1. Customer documents in history — FIXED
**Issue:** Uploaded ID documents (Aadhaar / PAN / passport) were stored but could not be viewed from a guest's history — only a "scan on file" label showed.
**Fix:** Each ID on the guest profile now has a **View** button (and **Back** for two-sided IDs) that opens the actual scanned image. Access is permission-gated (`guest:view-pii`) and the image streams from encrypted storage.
`src/app/api/guest-ids/[id]/scan/route.ts`, `guest-profile.tsx`, `guests/queries.ts`

## 2. Room pricing — FIXED
**Issue:** The nightly rate auto-filled from the room; rates differ per customer.
**Fix:** Data Entry no longer auto-populates the rate. It is **entered manually per guest** and that price is what bills. (Room dropdown no longer changes the price.)

## 3. Billing / invoice format — DONE (rebuilt to your reference)
The GST tax invoice now matches the client's reference photo (Tally-style):
- Company header: legal name, Reg. Office, **GSTIN/UIN**, **State + Code**, **CIN**, **E-Mail** (from `src/lib/constants/company.ts` — confirmed with client)
- Meta box: Invoice No · Date · **Check-in** · **Check-out** · **Booking source** · **Payment method**
- Consignee (guest) + place of supply
- Description table: room stay as one line (Qty = nights × rate) + each extra (Food/Laundry/Car rent/Extra bed) with HSN/SAC
- Amount chargeable **in words**
- **CGST / SGST summary** grouped by HSN·rate (rate + amount columns) + totals
- **Declaration** + "for M/s Woodpecker… Authorised Signatory"

Generated invoices render lazily on **View PDF**. *(Invoice number is `HKD17/2026-27/NNNNN` style; can be switched to a `WASF-…` prefix on request.)*
`invoice-pdf.tsx`, `invoice-pdf-store.ts`, `company.ts`

## 4. GST Including / Excluding — DONE (Data Entry + live booking)
One toggle wherever a bill is created:
- **Price includes GST** → the amount entered already contains GST; nothing extra is added (the taxable value is worked backwards out of it).
- **Add GST on top** → the amount is pre-tax and GST is added.
Applies to **room charge and every extra charge**. Available in **Data Entry** and in the **live New Booking / check-in** flow.

## 5. Payments & payment methods — DONE
Multiple payments per guest, each recorded separately with its own **method** (Cash / UPI / Credit card / Debit card / Bank transfer / Online / Corporate), **amount**, optional **reference/txn no.**, and **date**. Full payment history is kept on the folio. (`postPaymentTx` gained an optional back-dated `receivedAt`.)

## 6. Billing integration — DONE
Room pricing (manual), GST (inclusive/exclusive), extra charges (with correct SAC GST — food 5%, laundry 18%, etc.), multiple payments, and payment methods all flow into one folio and onto the invoice. The final bill reflects exactly what was entered.

## 7. Expense / Voucher management — DONE (exposed to owner)
The Expenses console already supported everything required — **category** (Housekeeping / Kitchen / Maintenance / Utilities / Admin / Misc), **description**, **amount**, **date**, **property**, **payment method**, **bill photo**, **vendor**, plus an approve/reject flow. It was only in the Accounts login; it is now in the **Super-Admin (owner/admin) menu** so the owner sees per-property spend.

## New Booking — property first (mid-work request)
The New Booking form now asks for the **Property first**, then shows **that property's room categories** (previously it was locked to the active property). Switching property resets category/rooms.

## 8. Property-owner perspective
The system now covers, from one owner/admin login: customers & documents, check-in/out, rooms & manual pricing, GST-correct billing & invoices, multiple payments & methods, per-property expenses, occupancy/revenue/ADR/RevPAR, guest history, and consolidated financials across all 4 properties. Historical/current stays can be back-filled (Data Entry) or created live (New Booking), and current guests can be **extended**.

## 9. Login access (ready)
URL **hotelmanagement.aiagentixdev.com** · password (all): **`woodpecker-dev-2026`**

| Role | Email |
|---|---|
| **Owner / Admin** | `admin@woodpecker.example` |
| Manager | `manager.mg@woodpecker.example` |
| Reception | `reception.mg@woodpecker.example` |
| Accounts | `accounts@woodpecker.example` |
| Housekeeping | `housekeeping.mg@woodpecker.example` |
| Maintenance | `maintenance.mg@woodpecker.example` |

Use **admin@woodpecker.example** for the full owner view.

---

## Currently working / completed
Items 1–9 above + property-first booking. All changes are TypeScript-checked, lint-clean, unit-tested where applicable, and build-verified. Commits: `c653f6e` (docs/price/payments/expenses), `a0fd82a` (invoice format + property-first), `c3a6ee1` (live GST toggle).

## Remaining / recommendations
- **Verify the invoice** on the live system (generate → View PDF) after redeploy; confirm the layout reads as expected on your printer.
- **Invoice number prefix** — switch to `WASF-…` if you want it to match the old series exactly.
- **Near-GST-band edge case** (rooms priced right at ₹7,500) — inclusive back-computation can pick the 12% band; irrelevant at your current tariffs (₹2,500–₹3,500) but worth noting.
- **Data cleanliness** — test entries must be removed surgically (financial rows are append-only); a full wipe deletes real data, so never run the wipe once the client is entering live data.
