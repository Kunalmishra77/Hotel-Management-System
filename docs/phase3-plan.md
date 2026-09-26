# Phase 3 — Portal simplification & "modern hotel CRM" plan

**Status: FOR REVIEW — no code changed. Implement one module at a time after approval.**
Client: Woodpecker — 4 Hauz Khas properties, one management team, one admin login.
Goal: **fewer, clearer, business-justified pages**; a modern centralized dashboard; every page answerable to "why is this here?".

---

## A. The #1 root cause: "Create Property" everywhere

25 per-property pages render one shared empty-state component (`NoProperty`) that says
"pick a property / **Create a property**". They show it because the admin now defaults to
**All hotels** (no single active property), which we introduced at the client's request.
So it's not 25 separate bugs — it's one: **a per-property page with no property selected
falls back to a create/pick screen.**

**Fix (do first, one change, clears all 25):** replace that fallback with a **Property
Chooser** — the 4 properties as clickable cards ("choose a property to view its rooms /
expenses / housekeeping …"). Picking one scopes the page (sets the active property).
"Create a property" appears **only** in Properties, and only as an admin action. This also
delivers requirement #9 (Rooms shows the 4 properties first) and #36 (property cards).

Pages fixed by this one change: rooms, rooms/categories, bookings/calendar, bookings/form-c,
feedback, housekeeping, maintenance, pricing, payroll, staff, staff/field, channels,
booking-site, pos, pos/kitchen, inventory, inventory/laundry, billing, expenses, reports.

---

## B. Proposed final navigation (from ~35 items → ~16)

Grouped, each with a one-line business reason. **Keep / Improve / Rename / Merge / Remove.**

### 🏠 Overview
| Page | Action | Why |
|---|---|---|
| **Dashboard** (was "Command centre") | RENAME + IMPROVE | The control room: consolidated KPIs across 4 properties, clickable metrics, tooltips, property + date + channel filters, property-wise expense charts. |
| Portfolio insights | **REMOVE** → into Dashboard | Duplicates dashboard data; a separate page adds no action. |

### 🛎️ Front desk
| Page | Action | Why |
|---|---|---|
| **Bookings** | KEEP + IMPROVE | New booking, board, calendar. Make the metric cards clickable (→ filtered lists). |
| **In-house** | KEEP (done: portfolio + search + filters) | Who's staying now, per property, payment + pending docs. |
| **Rooms** | FIX + IMPROVE | Property cards → floor/BHK → rooms with live status. (Property chooser, not create.) |
| Form C | KEEP, FIX | FRRO register for foreign guests, per property (no create-property). |

### 👤 Guest CRM
| Page | Action | Why |
|---|---|---|
| **Guests** | KEEP + IMPROVE | The centralized CRM: search all properties, history, stays, payments, invoices, docs, communication. |
| **Feedback** | KEEP, FIX | Property-specific ratings/reviews (no create-property). Could later be a Guests tab. |
| Guest requests | **MERGE** → In-house/guest actions or **REMOVE** | Extra towel/late-checkout etc. Only if they'll use it; else remove the empty page. |
| Guest messages | **MERGE** → Communications | Guest chat belongs with communication, not a separate page. |
| Add-on requests | **MERGE** → folio "+ Charge" / **REMOVE** | Add-ons already post to the folio; standalone page is empty. |

### 💰 Money
| Page | Action | Why |
|---|---|---|
| **Billing** | KEEP + IMPROVE | Property filter + date/source/payment-status/GST filters, totals; GST-claims as a tab here. |
| GST Claims | **MERGE** → Billing tab | Same data, one place. |
| **Expenses** | KEEP + IMPROVE | Property-wise + category + payment-method + trends + charts (done partly; add charts). |
| **Reports** | KEEP + IMPROVE | Real management reports (revenue, occupancy, expenses, GST, dues, per-property). |
| Approvals | **MERGE** → Expenses (inline approve) | Expense approval is the only real approval; do it in-list. |
| Accounting sync | **DECISION** | Keep only if they use Tally/Zoho; else remove. |
| Corporate | KEEP if corporate clients exist; else REMOVE | Company clients, GST, corporate dues. |

### 🧹 Operations
| Page | Action | Why |
|---|---|---|
| **Housekeeping** | KEEP, FIX | Room clean/dirty/ready status per property (property chooser). |
| **Maintenance** | KEEP, FIX | Repair jobs per property. |
| Room inspection | **MERGE** → Housekeeping | A housekeeping sub-step, not its own module. |
| Assets & equipment | **MERGE** → Maintenance or **REMOVE** | Only if they track assets; else remove (all zeros now). |
| Lost & found | KEEP small or **REMOVE** | Minor; keep under Housekeeping if used. |
| Inventory / Laundry | **DECISION** | Client named milk/laundry/supplies as **expenses**. If they don't do stock-counting, remove these and track as Expenses. |
| POS / Kitchen | **DECISION → likely REMOVE** | Serviced apartments; no restaurant mentioned. Hide unless they run F&B. |

### 👥 People
| Page | Action | Why |
|---|---|---|
| **Staff & Payroll** | **MERGE** Staff + Payroll into one People module, FIX | Staff records + attendance + monthly salary in one place, per property. |
| Field staff | **REMOVE** unless they have drivers/field agents | Driver location tracking — out of scope otherwise. |

### ⚙️ Setup
| Page | Action | Why |
|---|---|---|
| **Properties** | KEEP + IMPROVE | Premium property cards; the ONLY place to create/edit a property. |
| **Communications** | KEEP + IMPROVE | Templates + automations (booking/check-in/checkout/payment) + message log; absorb Guest Messages. Clearer, less "dark/plain". |
| **Import / Export** | KEEP + IMPROVE | Data entry + bulk import/export with better UI, mapping, validation, history. |
| **Users & Access** | KEEP, FIX nav | Simple role/permission management. |
| **Settings** | KEEP + IMPROVE | The control room: company/GST/billing/notification/booking config. Fix the Users↔Settings nav overlap. |
| AI Assistant | **DECISION / clarify** | Keep only if we ground it to real Q&A ("today's revenue", "pending dues", "rooms to clean"); else hide behind a flag. |
| Channels / Booking site | **HIDE until activated** | Need OTA certification / booking-engine go-live; not usable now. Keep code, remove from nav until live. |
| Owner portal | KEEP SEPARATE | Different audience (property owners), not the admin's nav. |

**Net: ~16 admin pages** (from ~35), each with a clear purpose.

---

## C. Dashboard redesign (requirements #1–5)

- **Rename** Command centre → **Dashboard**.
- **Clickable metrics** — each KPI links to its detail/filter: Revenue→Reports(revenue), Occupancy→Rooms/occupancy, Pending dues→Billing(due), Cancellations→Bookings(cancelled), etc.
- **Tooltips / short definitions** on every metric (ADR, RevPAR, GOPPAR, Occupancy, Live occupancy, Net revenue, Pending dues) so a manager understands each.
- **Filters:** All properties / each property · date range · booking channel.
- **Property-wise expense overview:** per-property totals + category breakdown (donut) + monthly trend (line) + property comparison (bar). "Where is the money going" at a glance.
- **Consolidated + per-property** across all 4 hotels.
- Modern, clean, data-driven — charts only where they add meaning (dataviz standards), not decoration.

---

## D. Scope decisions — ANSWERED by client (26 Sep 2026)

1. **POS + Kitchen** — **REMOVE.**
2. **Inventory + Laundry** — **REMOVE** (milk/laundry/supplies tracked as Expenses).
3. **Channels + Booking site** — **HIDE** until activated.
4. **Accounting sync (Tally/Zoho)** — **REMOVE.**
5. **Corporate** — **REMOVE.**
6. **Field staff** — **REMOVE.**
7. **AI Assistant** — **KEEP, but make it genuinely capable** — a manager can ask anything about the system and get a real, grounded answer (occupancy, revenue, dues, expenses, rooms to clean, cancellations, per-property, etc.). Build it to that level.
8. **Guest requests / Add-ons** — **REMOVE.**

Resulting nav after removals (~13 pages): Dashboard · Bookings · In-house · Rooms · Guests ·
Feedback · Billing (GST tab) · Expenses · Reports · Housekeeping · Maintenance · People
(Staff+Payroll) · Properties · Communications · Import/Export · Users & Access · Settings ·
AI Assistant. (Channels/Booking-site hidden; Owner portal separate.)

---

## E. Implementation order (one module at a time, tested each)

1. **Property Chooser** — kills "Create Property" on all 25 pages (biggest visible win). ★ first
2. **Dashboard** — rename, clickable metrics, tooltips, filters, property-wise expense charts.
3. **Rooms** — property cards → floors/BHK → rooms.
4. **Nav consolidation** — remove/merge Portfolio-insights, Guest-messages, Add-ons, Approvals, Room-inspection, (POS/Kitchen/Inventory/Laundry/Channels/Booking-site/Field-staff/Accounting per decisions).
5. **Bookings** — clickable cards → filtered lists.
6. **Guests CRM** — history/stays/payments/invoices/docs tabs.
7. **Billing + GST** — property filter, GST-claims tab.
8. **Expenses** — charts + category/trend.
9. **People** — Staff + Payroll merged.
10. **Housekeeping + Maintenance** — property chooser + clean workflow.
11. **Communications** — clearer, absorb Guest Messages.
12. **Reports** — real reports.
13. **Settings + Users** — fix overlap, organize.
14. **Import/Export**, **AI**, **Feedback**, **Form C**, **Properties cards** — polish.

Each step: analyze → explain → implement → build/test → verify no regressions → next.
