# Client hand-off message (ready to send)

---

**Subject: Your Property Management System is ready — how to add your data**

Dear Sir,

Your Property Management System is now live and fully working. We have set it up with your four Hauz Khas properties and their rooms already configured, so you can start using it straight away. All the demo/sample data has been cleared — from here on, everything you see in the system will be **your own real business data**.

Please follow the steps below to log in and begin entering your data. Once you add a booking, it will flow automatically through the whole system — the guest record, the folio (bill), GST invoice, and payment receipt are all generated for you, and every report and dashboard updates in real time.

**1. Log in**
- Open the system and sign in with the administrator account we shared with you.
- Please change the password on first login (Settings → Users & Access).

**2. Your properties & rooms are already set up**
- Your four Hauz Khas properties and all 16 rooms are pre-configured with their tariffs. You can review or adjust them under **Properties** and **Rooms**.

**3. Add a booking (day-to-day)**
- Go to **Bookings → Front desk → New booking**.
- Enter the guest's details and dates — this creates the guest and the reservation together.
- When the guest arrives, open the booking and click **Check in**.

**4. Billing happens automatically**
- Open the booking's **Folio** to add any charges (room, food, extra bed, services, add-ons), apply a discount, or take a payment.
- Click **Generate GST invoice** for a proper tax invoice (downloadable PDF), and each payment has a **receipt** PDF.
- The balance, taxes and totals are always calculated for you.

**5. Bringing in your existing/old data**
You can load your historical records in two ways:
- **Import & Export** (in the admin panel) — upload your existing guests, bookings and other records in bulk from an Excel/CSV file. Download the template, fill it, upload, review, and confirm.
- **Data Entry** (in the admin panel) — for old paper records: photograph or upload the document, enter the details (the system can pre-fill from the photo where available), and save.

**6. See everything at a glance**
- The **Dashboard**, **Bookings**, **Billing** and **Insights** sections show live occupancy, revenue, dues, ADR/RevPAR and more — per property and across all four together.

Everything is working end-to-end. As you enter your bookings and payments, your data will appear correctly and logically across every screen — folios, invoices, receipts, guest history, and all reports.

If anything is unclear or you would like us to walk you through it on a call, please let us know — we're happy to help.

Warm regards,
[Your name]

---

## Internal note (for you, not the client)

**How to switch the live system to the clean, client-ready state:**
1. **Redeploy** on Coolify (to include the latest fixes).
2. **Wipe** (you run it): `cd "d:\Agentix Project\HMS by Agentix"; $env:CONFIRM="WIPE"; node tmp-wipe.mjs`
3. **Clean seed** (Claude runs, or you): `ALLOW_PROD_SEED=yes npx tsx prisma/seed/clean.ts`
   → org + staff logins + the 4 Hauz Khas properties + 16 vacant rooms, **zero** guests/bookings/folios.

**Login credentials to give the client** (all password `woodpecker-dev-2026` — ask them to change it):
- Admin: `admin@woodpecker.example`
- (Reception / Accounts / Housekeeping / Maintenance logins also exist — share as needed.)

After the clean seed the client's staff enter data via **New booking**, **Import & Export**, and **Data Entry** as described above.
