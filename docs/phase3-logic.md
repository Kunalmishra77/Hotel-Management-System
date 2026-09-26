# Phase 3 — The business logic behind every module (research-grounded)

**Purpose of this doc:** so the owner can answer "why is this page here?" and "what does it do?"
for every screen. Nothing here is asserted without a reason. No code yet.

**Research basis (what modern PMS/CRM products actually do):**
- Core PMS = reservations/front-desk, housekeeping, guest CRM, billing/payments, maintenance,
  reporting — POS, channel manager, inventory are **optional add-ons, not core**
  ([roomMaster — 12 core functions](https://www.roommaster.com/blog/functions-of-property-management-system),
  [AltexSoft — PMS guide](https://www.altexsoft.com/blog/hotel-property-management-systems-products-and-features/),
  [HotelTechReport](https://hoteltechreport.com/news/what-is-hotel-pms)).
- Small independent properties should track a **small set** of KPIs on a daily/weekly/monthly
  cadence, not "dashboards no one reads"
  ([roomMaster — 2026 KPI guide](https://www.roommaster.com/blog/hotel-performance-metrics),
  [Mews — hotel KPIs](https://www.mews.com/en/blog/hotel-industry-kpis),
  [Revfine — ADR/RevPAR/GOPPAR](https://www.revfine.com/what-is-adr-revpar-goppar/)).
- **Conclusion:** for 4 serviced-apartment properties run by one team, the right system is the
  lean core + the India-specific bits (GST) + expenses. Everything the client asked to remove
  (POS, inventory, channels-live, accounting-sync, corporate, field-staff) is a non-core add-on —
  removing them is aligned with best practice, not a shortcut.

---

## 1. The KPI definitions (plain language — these become dashboard tooltips)

| Metric | Plain meaning | Formula | Why the manager cares |
|---|---|---|---|
| **Occupancy %** | How full you were over a period | occupied room-nights ÷ available room-nights | Demand / how well you're filling rooms |
| **Live occupancy** | How full you are *right now* | rooms currently OCCUPIED ÷ sellable rooms | Today's floor state (different from the period %) |
| **ADR** (Avg Daily Rate) | Average price of a sold room | room revenue ÷ occupied room-nights | Your pricing power (room income only, ex-tax) |
| **RevPAR** (Rev/Available Room) | Room income per room you *had*, sold or not | room revenue ÷ available room-nights (= ADR × occupancy) | Combines price + how full — the core revenue health number |
| **GOPPAR** (Gross Op. Profit/Avail Room) | Profit per available room after running costs | (revenue − operating expenses) ÷ available room-nights | Are you actually *profitable*, not just busy |
| **Net revenue** | Revenue you keep after OTA commission | revenue − OTA commission | Real earnings on OTA bookings vs direct |
| **Pending dues** | Money guests still owe | Σ folio balances (charges + tax − payments) | Cash to collect — the "chase this" number |
| **Cancellations / No-shows** | Bookings that fell through | count + % of bookings | Lost demand; a spike is a warning |

> These four rules also fix the client's confusion: each metric gets a one-line tooltip on the
> dashboard, and clicking it opens the detail (Revenue→Reports, Dues→Billing filtered to "due",
> Cancellations→Bookings filtered to cancelled, Occupancy→Rooms, etc.).

---

## 2. Kept modules — the logic (purpose · why · data · actions)

### Dashboard (was "Command centre")
- **Purpose:** the one screen the manager opens first — the health of all 4 properties.
- **Why:** a small team needs a single consolidated pulse, not scattered pages.
- **Data:** the KPIs above (consolidated + per-property), revenue trend, today's arrivals/
  departures/occupancy, **property-wise expense overview** (donut by category, bar by property,
  line trend), pending dues, cancellations.
- **Actions:** filter (all/each property · date · channel); click any metric → its detail.

### Bookings
- **Purpose:** create and manage reservations; the front-desk board.
- **Why:** the operational heart — every stay starts here.
- **Data:** new booking, board (arrivals/in-house/departures), calendar, per-status counts.
- **Actions:** new booking, check-in/out, cancel (pre-arrival), extend, **clickable count cards**
  → filtered lists (today's, upcoming, cancelled, pending).

### In-house
- **Purpose:** who is staying right now, across all properties.
- **Why:** the daily "who's here, who owes, who's leaving" view.
- **Data:** guest, property, room, check-in, expected check-out, payment status, pending docs.
- **Actions:** search + date filters (done), open booking/folio.

### Rooms
- **Purpose:** the physical map — properties → floors/BHK → rooms with live status.
- **Why:** you can't run a hotel without seeing room state; also feeds availability.
- **Data:** 4 property cards (image, name, location, total/occupied/available) → drill into a
  property → floors / BHK units → rooms (Vacant/Occupied/Reserved/Maintenance/Housekeeping).
- **Actions:** pick a property (Property Chooser, NOT create), change room status, see the BHK
  "whole unit vs individual rooms" structure.

### Guests (the CRM)
- **Purpose:** the permanent customer memory across all 4 properties.
- **Why:** repeat guests, history, and "who is this person" — the CRM the client asked for.
- **Data (as profile tabs):** profile, stay history, bookings, payments, invoices, ID documents,
  communication history.
- **Actions:** search all properties, edit while a stay is active (view-only after checkout).

### Feedback
- **Purpose:** guest ratings/reviews, tied to the correct property.
- **Why:** service quality per property; feeds nothing else, so it's small but real.
- **Data:** property, guest, rating, comment, date, category, status, response.
- **Actions:** view per property (Property Chooser), respond. (Could later be a Guests tab.)

### Billing (+ GST tab)
- **Purpose:** every folio and GST invoice.
- **Why:** money correctness + statutory GST invoices (India).
- **Data:** invoices with property/date/source/payment-status/GST filters + totals; GST-claim
  register as a tab (guest-GSTIN bills).
- **Actions:** generate/share invoice, fix room rate, take payment, filter, export.

### Expenses
- **Purpose:** where money goes, per property.
- **Why:** profit = revenue − expenses; the client explicitly wants this visible.
- **Data:** property, category (salary/milk/laundry/electricity/water/maintenance/supplies/…),
  amount, date, payment method, vendor, receipt, notes. Property-wise + category + trend charts.
- **Actions:** add expense, filter, approve (inline — Approvals merged here).

### Reports
- **Purpose:** management reports for decisions/accountant.
- **Why:** the numbers behind the dashboard, exportable.
- **Data:** revenue, occupancy, bookings, cancellations, per-property revenue & expenses, GST,
  billing, payments, outstanding dues, guest, profit.
- **Actions:** pick report + date/property, view, export (Excel/PDF/CSV).

### Housekeeping
- **Purpose:** room readiness per property.
- **Why:** you can't sell a dirty room; mobile-first for staff.
- **Data:** room status (clean/dirty/in-progress/ready/re-clean), assigned staff, property, time.
  Room-inspection merged in as a status step.
- **Actions:** pick property, update status, assign.

### Maintenance
- **Purpose:** repair/upkeep jobs per property.
- **Why:** track issues to resolution + cost.
- **Data:** property, room, issue, category, priority, assignee, status, date, resolution, cost.
- **Actions:** pick property, log/close jobs, preventive reminders. (Assets merged or removed.)

### People (Staff + Payroll merged)
- **Purpose:** staff records + attendance + monthly salary, per property.
- **Why:** one place for the team; salary is the biggest expense.
- **Data:** staff profile, department, property, role, join date, attendance, monthly salary,
  payroll run status, paid/pending.
- **Actions:** add staff, mark attendance, run payroll, mark paid.

### Properties
- **Purpose:** the 4 hotels — the ONLY place to create/edit a property.
- **Why:** property is the top of the tree; everything else references it.
- **Data:** premium cards (image, name, location, rooms, occupancy, available).
- **Actions:** add/edit property, GST/owner config.

### Communications
- **Purpose:** guest messaging — automations + templates + log.
- **Why:** the client wants booking/check-in/checkout/payment messages; absorbs "Guest Messages".
- **Data:** templates, automations (per event), campaigns, message log (WhatsApp/Email).
- **Actions:** edit templates/automations, send, view log. Clearer, less "dark/plain".

### Import / Export
- **Purpose:** data entry + bulk import/export.
- **Why:** go-live history + ongoing data movement.
- **Actions:** better UI, mapping, validation, error report, history.

### Users & Access
- **Purpose:** who can log in and do what.
- **Why:** even one team needs basic access control.

### Settings (control room)
- **Purpose:** system config — company/GST/billing/notification/booking settings.
- **Why:** the one place to configure the business. Fix the Users↔Settings nav overlap.

### AI Assistant (client wants this genuinely capable)
- **Purpose:** ask anything about the business, get a real grounded answer.
- **Why:** the client explicitly wants a manager Q&A that actually works.
- **Data it reads:** occupancy, revenue, dues, expenses, rooms-to-clean, cancellations,
  per-property — computed from the DB, not guessed.
- **Actions:** answer questions ("today's revenue?", "which property is fullest?", "pending
  dues?", "rooms to clean?", "this month's expenses?"). Read-only; grounded in real data.

---

## 3. Removed / hidden — the logic (why it's OK to remove)

| Removed | Why (business logic) |
|---|---|
| POS, Kitchen | Serviced apartments, no restaurant. Non-core add-on. |
| Inventory, Laundry | Client tracks milk/laundry/supplies as **expenses**, not stock counts. |
| Channels, Booking site | Need OTA certification / booking-engine go-live; OTA bookings entered manually for now. Hidden (code kept) until activated. |
| Accounting sync | Not using Tally/Zoho. |
| Corporate | Not billing companies. |
| Field staff | No drivers/field agents to track. |
| Portfolio insights | Duplicates the Dashboard. |
| Guest requests, Add-ons | Not used; add-ons already post to the folio. |
| Approvals (standalone) | Only real approval is expenses — done inline in Expenses. |
| Room inspection, Assets | Folded into Housekeeping / Maintenance (or removed). |
| Guest messages (standalone) | Folded into Communications. |
| GST Claims (standalone) | A tab inside Billing. |

**Result:** ~13–14 admin pages, each with a clear business reason — the "fewer, clearer,
useful" system the client asked for.

---

## 4. Implementation order (one at a time, tested each)
1. **Property Chooser** (kills "Create Property" on all 25 pages) ★ first
2. Nav cleanup (remove the 8 modules above + merges)
3. Dashboard (KPIs clickable + tooltips + filters + property-wise expense charts)
4. Rooms (property cards → floors/BHK → rooms)
5. Bookings (clickable cards)
6. Guests CRM (tabs)
7. Billing + GST tab
8. Expenses (charts)
9. People (Staff+Payroll)
10. Housekeeping + Maintenance
11. Communications
12. Reports
13. Settings + Users
14. AI Assistant (genuinely grounded Q&A)
15. Import/Export, Feedback, Properties cards — polish
