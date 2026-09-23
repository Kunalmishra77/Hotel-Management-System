# Woodpecker PMS — Client Demo Guide

Follow this top-to-bottom (~15 min). Each step says **where to go**, **what to do**, and **what to point out** (and which of the 10 requirements it proves ✅).

**Before you start:** open **hotelmanagement.aiagentixdev.com**, log in as **admin@woodpecker.example** / **woodpecker-dev-2026**, and press **Ctrl + Shift + R** once.

---

## Part 1 — The owner's dashboard (whole business at a glance)
**Where:** left menu → **Command centre**
**Do:** point to the top tiles; switch **Today / This month** at the top.
**Say:** "One screen for all 4 properties — revenue, occupancy, dues, arrivals. Everything the owner needs in one place." ✅ (#8 owner view)

---

## Part 2 — Data Entry (the main tool — proves the most)
**Where:** left menu → **Data Entry**
**Do & say, in order:**

1. **Returning guest** — in **Full name**, type a name that already exists (e.g. type part of a real guest's name). A dropdown appears → click the match.
   👉 *"If the guest has stayed before, one click reuses them — no duplicate record."* ✅ (returning-guest)

2. **Property → Room** — pick the **Property**, then the **Room**.
   👉 *"Pick property first, then its rooms."*

3. **Country → mobile code** — in Guest details, choose **Country** (e.g. Germany).
   👉 *"Country chosen, and the mobile code (+49) fills in automatically — works for foreign guests too."*

4. **Multiple IDs** — under **ID documents**, click **+ Add ID**, choose type, and **upload a photo**. Add a second one.
   👉 *"Each person's ID — Aadhaar, PAN, passport — uploaded here. Add as many as needed."* ✅ (#1 documents)

5. **Extra charges** — under **Extra charges**, **+ Add charge** → Food ₹500, add Laundry.
   👉 *"Meals, laundry, cab — all on the same bill with the right GST automatically."* ✅ (extra charges)

6. **Manual price + GST toggle** — in **Bill**, type the **Room rate** by hand. Show the two GST options: **Price includes GST** vs **Add GST on top**.
   👉 *"Rate is entered manually — it's different per customer, nothing auto-fills. And GST: if the price already includes GST, nothing extra is added; otherwise it's added on top."* ✅ (#2 manual price, #4 GST)

7. **Booking source** — pick **Booking source** (Direct / MakeMyTrip / Booking.com…).
   👉 *"Where the booking came from — shows in reports and on the invoice."* ✅ (booking source)

8. **Multiple payments** — under **Payments**, **+ Add payment** → Cash ₹3000; **+ Add payment** → UPI ₹2000.
   👉 *"A guest can pay in parts — part cash, part UPI — each recorded separately with date and reference."* ✅ (#5 payments)

9. **Current guest (in-house)** — set a **Check-out date in the future**.
   👉 *"A blue note appears — the guest is recorded as *currently staying*. It bills the nights so far automatically."* ✅ (current guests)

10. **Clear form** — click **Clear form** to show it wipes everything for a fresh entry. ✅ (clear form)

11. **Save** — fill a valid entry and click **Save historical stay** → *"✔ Saved"*.
    👉 *"Saved — and it now flows everywhere: Guests, Bookings, Billing, Reports."* ✅ (#6 integration)

---

## Part 3 — Guest history + documents
**Where:** left menu → **Guests** → search the guest you just saved → open them.
**Do:** scroll to **Identity documents** → click **View** on an ID.
**Say:** *"Full guest history, and every uploaded document is viewable right here."* ✅ (#1)

---

## Part 4 — Billing + the GST invoice
**Where:** left menu → **Billing**
**Do & say:**
1. Top tiles → *"Consolidated dues, collections, invoices across all properties."*
2. **Find a bill / invoice** panel → type a **customer name** → results appear. Try the **property** + **date** filters.
   👉 *"Search any customer's bill, or filter by property and date to pull a list."* ✅ (billing search)
3. Click **View** on any invoice → the **PDF opens**.
   👉 *"This is the exact GST tax-invoice format — company details, GSTIN, check-in/out, booking source, payment method, HSN/SAC, CGST/SGST, amount in words, declaration and signatory."* ✅ (#3 invoice format)

---

## Part 5 — Expenses
**Where:** left menu → **Expenses**
**Do:** show/add an expense → category (Electricity / Maintenance / Grocery / Repair…), amount, date, property, and a **bill photo**.
**Say:** *"Every property's spend — electricity, maintenance, grocery, repairs — recorded with a bill photo, so the owner sees exactly where money goes."* ✅ (#7 expenses)

---

## Part 6 — New Booking (live walk-in / future guest)
**Where:** top-right → **New booking**
**Do & say:**
1. **Property first**, then that property's **room category**. ✅ (property-first)
2. Dates (today or future) → **Check availability** → pick a room → pick/《+ New》guest.
3. In **Charges**, show the same **GST include/exclude** toggle. ✅ (#4 live)
4. **Confirm booking** (or **Book & check in now**).
5. On the booking's page, show **Extend stay** (for a guest staying longer). ✅ (extend)
👉 *"New Booking is for guests arriving today or later; past/existing guests go in Data Entry."*

---

## Part 7 — Reports & the big picture
**Where:** left menu → **Reports** / **Portfolio insights**
**Say:** *"Revenue, occupancy, ADR, profit — per property and across the group. Everything a property owner needs to run the business."* ✅ (#8)

---

## Wrap-up — say this
- *"Logins are ready for each role — Owner/Admin, Manager, Reception, Accounts, Housekeeping, Maintenance."* ✅ (#9)
- *"A full written report of everything done is available too."* ✅ (#10 — `docs/work-report-2026-09-22.md`)

**Tip:** if any screen ever shows *"Something went wrong,"* click **Try again** — it's a momentary reload, not data loss.
