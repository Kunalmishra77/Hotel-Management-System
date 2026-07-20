# Scope

Source of truth: the client's *PMS Requirement Document* (§1–§19). Decision: **all 19 sections are in scope and built now** — nothing deferred to a "phase 2". §19 "Future Expansion" items are full modules in this build.

## The 26 modules (each is a `specs/NN-*/` bundle)

| # | Module | Scope § | Notes |
|---|---|---|---|
| 00 | platform | 15,16,18 | Auth, tenancy, app shell, audit, backup, events — foundation |
| 01 | property-management | 1 | Properties, GST/owner, floors, real-time occupancy |
| 02 | room-inventory | 1 | Room categories, rooms, status (vacant/occupied/reserved/maintenance/housekeeping) |
| 03 | reservations | 2 | Booking, sources, nights, rate/discount/tax/advance/balance, auto-bill |
| 04 | guest-crm | 3 | Profile, contact, IDs+scans, additional info, search |
| 05 | guest-history | 4 | Visits, room-nights, revenue, preferences, bills, outstanding |
| 06 | billing-payments | 5 | **Folio + GST invoice + night audit**, payment modes, split |
| 07 | expense-management | 6 | Heads/categories, daily/monthly/property-wise |
| 08 | profit-reports | 7 | Income vs expense, per-property profit |
| 09 | staff-management | 8 | Records, attendance, salary calculation |
| 10 | housekeeping | 9 | Mobile room-status updates, linen, complaints |
| 11 | maintenance | 10 | Job records + preventive-maintenance reminders |
| 12 | communications | 11 | WhatsApp / Email / SMS automations + templates |
| 13 | booking-channel-integrations | 12 | OTA / channel manager connectors |
| 14 | dashboard-analytics | 13 | Live dashboard, occupancy, ARR, RevPAR, trends |
| 15 | search-export | 14 | Fast multi-field search; Excel/PDF/CSV export |
| 16 | access-control-security | 15,18 | RBAC, 2FA, encryption, audit trail, backup |
| 17 | mobile-experience | 16 | PWA, offline, responsive, cross-device sync |
| 18 | ai-features | 17 | Chatbot, NL search, sentiment, forecast, rate suggest, segmentation |
| 19 | pos | 19 | Restaurant / point of sale → posts to folio |
| 20 | inventory-stock | 19 | Store/stock inventory (distinct from room inventory) |
| 21 | payroll | 19 | Salary runs from staff + attendance |
| 22 | accounting-sync | 19 | Tally / Zoho Books export/sync |
| 23 | booking-engine | 19 | Public direct online booking website |
| 24 | dynamic-pricing | 19 | Occupancy/season-based rate automation |
| 25 | corporate-crm | 19 | Corporate/travel-agent sales relationships |

## Out of scope (explicit)
- Native iOS/Android apps — the **PWA** covers all devices (§16). Native shells can wrap the PWA later without re-architecture.
- Building our own OTA/payment/messaging networks — we integrate; we do not replace them.
- Going *live* on WhatsApp/SMS/OTA/payments without the client completing external onboarding (KYC, DLT, BSP, OTA certification). We build + sandbox-verify; the client activates. See `integrations.md`.

## Scope-change rule
Any new requirement updates the relevant `specs/NN-*/requirements.md` **and** this file before code changes. Scope drift without a spec update is prohibited.
