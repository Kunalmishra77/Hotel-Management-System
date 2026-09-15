# Woodpecker PMS — Client Onboarding (ready to share)


Dear Sir,

Your Property Management System (PMS) is now live and fully working. We have already set up your **four Hauz Khas properties and all 16 rooms with their tariffs**, and cleared all sample data — so everything you see from now on will be **your own real business data**.

This message explains how to log in and add your data step by step. The system is fully connected: once you enter a booking, the guest record, folio (bill), GST invoice, payment receipt, dashboards and reports all update automatically — no double entry.

---

## 1. How to access the system

**Website (open in Chrome on any laptop, phone or tablet):**
**https://hotelmanagement.aiagentixdev.com**

You can also "Add to Home Screen" on a phone to use it like an app.

**Login accounts** (please change every password on first login — see step 2):

| Role | What they do | Login email | Password |
|---|---|---|---|
| Administrator / Owner | Full access, all properties, reports | `admin@woodpecker.example` | `woodpecker-dev-2026` |
| Manager | Runs the properties, approvals, reports | `manager.mg@woodpecker.example` | `woodpecker-dev-2026` |
| Reception | Front desk: bookings, check-in/out, billing | `reception.mg@woodpecker.example` | `woodpecker-dev-2026` |
| Accounts | Invoices, payments, expenses, exports | `accounts@woodpecker.example` | `woodpecker-dev-2026` |
| Housekeeping | Room cleaning status | `housekeeping.mg@woodpecker.example` | `woodpecker-dev-2026` |
| Maintenance | Repair jobs | `maintenance.mg@woodpecker.example` | `woodpecker-dev-2026` |

*(These are starter accounts. You can create more staff logins later under Settings → Users & Access.)*

---

## 3. Review your properties & rooms (already set up)

- Open **Properties** to check each of your four Hauz Khas properties — address, GST number, and details. Edit anything that needs correcting.
- Open **Rooms** to see all 16 rooms. Tap a room to view its status; open **Rooms → Categories** to review or change the **per-night tariffs**.

Everything here is already configured — you only need to adjust rates or details if required.

---

## 4. Add a booking (your day-to-day work)

This is the main flow. From the **Command Centre** (home screen) or **Bookings → Front desk**:

1. Click **New booking**.
2. Enter the guest's name, mobile, dates and room — this creates the **guest record and the reservation together** (no separate step).
3. When the guest arrives, open the booking and click **Check in** (capture ID/photo, signature).
4. Open the booking's **Folio** to:
   - **Add charges** — room, food, extra bed, laundry, services, or a catalogue **Add-on**.
   - **Apply a discount** if needed.
   - **Take payment** (cash / UPI / card, or split).
   - **Generate GST invoice** → a proper tax-invoice PDF you can print or send.
   - Each payment also has a **receipt PDF**.
5. At departure, **Check out**.

The bill, taxes, paid amount and balance are always calculated for you — nothing to total by hand.

---

## 5. Bring in your existing / old data

You have two ways, both in the admin panel:

**A) Import & Export (bulk, from Excel/CSV)** — for lists you already keep in a spreadsheet.
1. Open **Import & Export**.
2. Choose what you're importing (Guests, Bookings, Opening balances, Rooms, Staff).
3. **Download the template**, fill in your data, and **upload** it.
4. The system **validates** it and shows a preview (errors/duplicates highlighted).
5. Click **Commit** to save — or **Roll back** if something's wrong.

**B) Data Entry — record a previous stay** — the simplest way to enter past guests one by one.
1. Open **Data Entry**.
2. Choose the **Property**, and enter the **Check-in** and **Check-out** dates (these three are required).
3. Enter the guest's Name, Mobile, Address, City, Country, Date of Birth, and their **ID** — either **upload the ID document/photo** or **type the ID number**.
4. Optionally add the **room rate** and **amount collected** — the system then creates the bill for that stay.
5. **Save.** The stay is recorded under that property for those dates, and immediately appears in that property's **guest history, occupancy and revenue**. The form keeps the property selected so you can quickly enter the next guest.

Use **Import & Export** for large spreadsheets, and **Data Entry** to key in previous stays one at a time.

---

## 6. Record your expenses

Open **Expenses** to log daily/monthly spend by category (housekeeping, kitchen, utilities, staff, etc.). These feed straight into your **Profit** reports.

---

## 7. See everything at a glance

As you enter data, it appears **automatically and correctly everywhere**:
- **Command Centre / Dashboard** — today's arrivals, departures, occupancy, revenue, pending dues.
- **Insights & Reports** — occupancy %, ADR, RevPAR, revenue by source, profit — per property and all four together.
- **Billing** — outstanding dues, collections, and every GST invoice.
- **Guests** — each guest's full history, stays, and outstanding balance.

---

## 8. In short — the order to start

1. Log in as Administrator → change passwords.
2. Review Properties, Rooms and tariffs.
3. (Optional) Import your existing guests via **Import & Export**, or capture old records via **Data Entry**.
4. Start taking bookings: **New booking → Check in → Folio (charges & payment) → GST invoice → Check out**.
5. Record expenses.
6. Watch the dashboards and reports update in real time.

Everything is working end-to-end. If you would like us to walk your team through it on a short call, we're happy to help.

Warm regards,
**Agentix — Woodpecker Team**
