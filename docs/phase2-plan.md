# Woodpecker PMS — Phase 2 Plan (client change request, 25 Sep 2026)

**Status: FOR REVIEW — no code changed yet.** Sources: the 21-point brief, the Woodpecker Team email, the bank details, and the 4 client files (`INVOICE FORMATE.pdf` = our invoice with handwritten notes; `INVOICE FORMAT SAMPLE 5%.xlsx`; `INVOICE FORMAT SAMPLE MMT 5%.xlsx`; `Scanner .jpeg` = HDFC PayZapp QR standee).

---

## A. Decisions / conflicts to confirm first

1. **GST rate = flat 5% (2.5% CGST + 2.5% SGST) on everything** (room + food + extras). The brief said "2.5%", the email said "5%", the sample invoices show 2.5%+2.5% on both room and food → all consistent = 5% total. Today room = 12%, food = 5%. **Change: all charges → 5%.** ✅ assume yes unless you object.
2. **CIN mismatch** — the sample Excel says **`U45400DL2008PTC181581`**; earlier you confirmed **`U74140DL2009PTC181581`**. The Excel (your real template) is likely correct. **Which is right?**
3. **Invoice number prefix** — samples use **`WASPL : 730/ 25-26`** (WASPL + running no. + FY). Today we use `HKD17/2026-27/00001`. Switch to `WASPL/<FY>/<no.>`? Note: our numbering is **per-property gap-free**; a single `WASPL` series across all 4 properties needs one shared counter (I'll implement that).
4. **QR image** — the file is a photo of the PayZapp standee (angled, with background). For a clean invoice I need a **flat PNG of just the QR** (or I crop the photo — lower quality). Please send a clean QR PNG if you have it.
5. **Portal removal (#17–20)** — I will **not delete** the other portals' code (it's wired into roles + tests; deleting risks breakage). Instead I'll make the **Admin portal the single comprehensive workspace** (all modules in one nav) and the manager uses the **one admin login**. Confirm this is acceptable (vs. literally ripping out Manager/Reception/etc. code).
6. **Live email/WhatsApp delivery** — the messaging layer exists but runs in **mock/outbox** without provider credentials. Real emails need a verified sender domain (SPF/DKIM); WhatsApp needs an approved BSP template. I'll build the send + templates now; **actual delivery needs you to activate the provider** (a config step, no code change). Auto-email will queue until then.

**Bank details (confirmed, from your message + Excel):**
A/c Holder: Woodpecker Apartments & Suites Pvt. Ltd. · Bank: HDFC Bank · A/C: 50200052888170 · IFSC: HDFC0000467 · Branch: A-24 Hauz Khas, New Delhi.

**HSN/SAC (from the annotated PDF):** 996311 room/unit accommodation · 996331 food · 996601 car rent · 997212 rental/leasing · 9969xx electricity/water/utilities.

---

## B. Current system (what already exists — reuse)

- **Billing/folio + GST invoice PDF** (Tally-style, built last round). GST computed per line from `lib/constants/gst.ts` bands. Invoice PDF in `invoice-pdf.tsx` + `invoice-pdf-store.ts`. **Reuse & extend.**
- **Data Entry** (historical/current stays): manual rate, GST inclusive/exclusive, extra charges, multiple payments, multiple IDs, returning guest, booking source, extend. **Reuse.**
- **Expenses module** — category/description/amount/date/property/`paidVia` (payment method already exists!)/vendor/bill photo + approve flow. Now in Super-Admin nav. **Mostly done — needs the centralized multi-property view + filters.**
- **Communications** — `dispatch.ts`, `events/consumer.ts` (already listens for `GuestCheckedIn`), messaging providers (mock/live). **Reuse for auto-email/WhatsApp.**
- **Cancellation** — `cancelReservation` action + schema EXIST, but **no UI**. **Add UI.**
- **In-house page** — exists (74 lines) but incomplete/buggy. **Rebuild.**
- **Rooms/categories** — per-property categories exist; **no BHK grouping.**
- **Guest IDs** — stored + viewable; **no "pending" concept.**
- **Roles/portals** — role→portal nav in `portals.ts`/`navigation.ts`.

---

## C. Work items (requirement → plan)

### Billing & invoice (brief #1,2,3,4,11,12,13 + email)
- **GST 5%** — set room band to 5% (2.5%+2.5%) in `gst.ts`; food already 5%; make extras 5%. Config-driven. **[schema: none]**
- **Guest GST details on invoice + at booking** — add guest `gstNumber` capture in booking/data-entry (guest already has `gstNumber` field); show guest GSTIN + email + mobile on the invoice consignee block. **[schema: none — field exists]**
- **Invoice format to match samples** — company header (verify CIN), CHECK-IN/OUT, booking source, payment method, Period/Rate/%/Discount/Amount columns, HSN-grouped 2.5%/2.5% summary, **Amount in words**, **Company Bank Details block**, **QR image**, **"No Signature or Stamp Required."**, Authorised Signatory. **[reuse invoice-pdf.tsx]**
- **Bill amount ≠ actual rate (#4)** — add a **"billed rate"** separate from the actual/paid rate: the folio records the real money; the **invoice can show a different (higher) amount** the guest claims. Cleanest: an editable invoice line amount / a "bill-to amount" override captured at invoice generation, keeping payments/folio truthful. **[schema: small — invoice already stores its own taxable/total; add an override path]**
- **Editable bill (#11)** — allow authorized staff to edit invoice display fields (customer name/GSTIN/address, line descriptions, billed amounts) → since invoices are append-only, "edit" = **void + reissue** (a corrected invoice, credit-note trail) OR an editable **draft** before finalizing. Recommend: **draft invoice** the staff can edit, then finalize. **[schema: invoice `status` draft/final]**
- **MMT/OTA billing (#12)** — OTA invoice variant: shows OTA name tag ("(Make My Trip)"), the **OTA-agreed rate** (not rack), and separates **room amount / OTA commission / GST / net received / amount charged to customer**. Add OTA fields to the reservation/folio (commission, net). Provide an "OTA" invoice template. **[schema: OTA commission/net fields on reservation or a folio line type]**
- **GST Claim page (#13)** — a new admin page listing invoices where the guest asked for a GST bill (guest GSTIN present / flagged), to track/claim. **[schema: an `isGstClaim` flag on invoice or derive from guest GSTIN]**
- **Share by email + WhatsApp (email)** — "Share bill" action → email the PDF + WhatsApp link (via comms module). **[reuse comms]**

### Rooms / BHK (#5, email)
- For D-1/30, D-1/23, D-1/3 (2 BHK) and D-1/17-type (3 BHK): booking room selection offers **"2/3 BHK Complete"** OR **Room 1 / Room 2 [/ Room 3]** individually. Model BHK as a category grouping; "complete" = book all rooms of the BHK together. **[schema: BHK grouping on rooms/categories — a `bhkGroup` or parent unit]**

### Pending guest info/documents (#6, email)
- Mark specific items **Pending** at check-in (payment, email, Aadhaar, PAN, other ID). Show a **Pending panel** on the guest/booking and at checkout ("Pending: Email, Aadhaar, Payment"). Staff can fill anytime; guest can provide before checkout. **[schema: a `PendingItem` list or flags per reservation/guest]**
- Contact **verification at check-in** (email #): a step to re-confirm/edit guest email + mobile at check-in. **[reuse check-in flow]**

### Bookings / cancellation (#7, email)
- **Direct phone booking** — New Booking already covers this (staff creates manually; source = Phone). **[done — confirm]**
- **Manual cancel UI** — add a "Cancel booking" button (reason) using the existing `cancelReservation` action; show **CANCELLED** clearly in booking lists/status/history. **[reuse action + add UI]**

### In-house page (#8, email — "not working")
- Rebuild: total in-house guests, per-property counts, guest + property + room/BHK, check-in date, expected checkout, **payment status**, **pending docs**, and quick actions. **[reuse queries; new page + query]**

### Communications (#9, #16, email)
- **Auto email on check-in** — consume `GuestCheckedIn` → send a branded "Thank you for checking in…" email. **[reuse consumer + template]**
- **Online booking → guest comms** — on booking/check-in send booking/check-in details (email + WhatsApp). **[reuse]**
- (Delivery depends on provider activation — see A6.)

### Other property "Others" (#10, email)
- Add an **"Others" external property** option in booking/check-in: enter external hotel **name + full address + stay details** manually; show it clearly on the booking + invoice. **[schema: external-stay fields, or an `isExternal` property with free-text address on the reservation]**

### Expenses (#14, #15, #19)
- Payment methods — **already supported** (`paidVia`: Cash/UPI/Card/Bank/Online/Corporate). Add Paytm Wallet if wanted. **[schema: maybe extend enum]**
- **Centralized admin expenses** — one page: all 4 properties, filter by **property / date / category / payment method**, totals, per-property + overall views, recurring/salary tracking. **[reuse expense queries + new admin view]**

### Property documents (email)
- A **Documents tab** per property to store agreements/related files (object storage). **[schema: a `PropertyDocument` model]**

### Historical entries from 1 Apr 2026 (email)
- Ensure Data Entry + all sections accept past dates back to 1 Apr 2026 (FY 2026-27). Data Entry already allows past dates; verify reports/filters cover from Apr 2026. **[verify; likely no schema change]**

### Portal consolidation (#17,18,20)
- Make the **Admin portal the single workspace** with all modules in a logical nav: Dashboard · Bookings · In-House · Check-in/out · Guests · Properties · Rooms/BHK · Billing · GST/GST-Claims · Expenses · Payments · Documents · Reports · Communications. Manager uses the one admin login. Keep other portal code intact (safety) but effectively unused. **[nav consolidation; low DB impact]**

---

## D. Database / schema changes (summary)
- GST config: none (constants).
- Invoice: `status` (draft/final) for editable bills; optional billed-amount override; `isGstClaim`/derive.
- Reservation/folio: OTA commission + net fields; external-property ("Others") name/address; billed-vs-actual rate.
- Pending items: a `PendingItem` model (or flags) per reservation.
- Rooms: BHK grouping (`bhkGroup`/parent unit).
- `PropertyDocument` model (agreements).
- Expenses: maybe extend payment-method enum (Paytm).
- All migrations **additive** (no destructive changes); applied via `prisma migrate deploy`.

## E. Suggested phasing (each phase deployable, low risk)
1. **Invoice format + GST 5% + bank/QR + guest GST/email/phone + "No signature" + HSN + WASPL numbering** (highest client priority; the printed bill).
2. **Editable/manual billing + bill-amount override + MMT/OTA billing + GST Claim page + share email/WhatsApp.**
3. **Pending items + contact verification at check-in + In-house page rebuild + auto check-in email.**
4. **BHK room selection + "Others" external property + property documents tab.**
5. **Centralized expenses (filters/totals) + admin-portal nav consolidation.**
6. **Historical-from-Apr-2026 verification + cleanup + final report.**

## F. Risks / dependencies
- Live email/WhatsApp needs provider activation (client).
- Clean QR PNG needed (client).
- CIN to confirm (client).
- Editable invoice must preserve append-only financial integrity (draft-then-finalize, or void+reissue) — no silent edits to issued tax invoices (GST compliance).
- Portal consolidation kept non-destructive to avoid breaking tests/roles.
- Applying migrations to the LIVE DB while the client uses it — additive columns are safe; will time carefully.

## G. Needs from you (client input)
1. Clean **QR PNG**. 2. **CIN** confirm. 3. **WASPL** numbering ok? 4. **HSN for utilities/car** exact 6-digit if used. 5. **Paytm** wallet as an expense method? 6. Email provider activation (for real delivery). 7. Approve the phasing.
