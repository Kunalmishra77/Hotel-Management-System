# Requirements Traceability Matrix

Maps **every** section of the client's *PMS Requirement Document* (§1–19 + Objective + Expected Outcome) to where it is covered, and records gaps found during review + how they were resolved. Status: ✅ covered · 🔧 gap found & fixed this pass · ❗ open (needs client).

## §1 Property Management
| Requirement | Covered by | Status |
|---|---|---|
| Multiple properties from one dashboard | 01, 14 dashboard, `Property` | ✅ |
| Property Name, Address, GST, Owner | 01, `Property.{name,address*,gstin,ownerName}` | ✅ |
| Number of Rooms/Apartments | derived from `Room` count (01 overview) | ✅ |
| Room Categories, Floor-wise details | 02 `RoomCategory`, 01 `Floor` | ✅ |
| Room Status (Vacant/Occupied/Reserved/Under-Maintenance/Housekeeping) | 02 `RoomStatus` enum + state machine | ✅ |
| Real-time occupancy per property | 01 FR-6/7, SSE realtime, 14 | ✅ |

## §2 Reservation Management
| Requirement | Covered by | Status |
|---|---|---|
| Guest Name, #Guests (Adults/Children) | 03 `Reservation.{adults,children}`, 04 `Guest` | ✅ |
| Check-in/out Date **& Time**, #Nights | 03 `checkInDate/Out` (date) + `checkInAt/Out` (time) + `nights` | ✅ |
| Room Number, Room Type | 03 allocation → `Room`, `RoomCategory` | ✅ |
| Booking Source (Direct/Website/Phone/Walk-in/Airbnb/Booking.com/Agoda/MMT/Goibibo/Corporate/Travel Agent) | 03 `BookingSource` enum (all 11) | ✅ |
| Room Rate, Discount, Extra Bed, Taxes, Other Charges, Advance, Balance | 03 fields + 06 folio; auto bill preview (03 FR-6) | ✅ |
| System auto-calculates final bill | 03 `priceReservation`, 06 folio balance | ✅ |

## §3 Guest Database (CRM)
| Requirement | Covered by | Status |
|---|---|---|
| Personal (Name/Gender/DOB/Anniversary/Nationality/Occupation) | 04, `Guest.*` | ✅ |
| Contact (Mobile/WhatsApp/Email) | 04, `Guest.{mobile,whatsapp,email}` | ✅ |
| Residential Address (+City/State/Country/PIN) | 04, `Guest.address*` | ✅ |
| Identification (Aadhaar/Passport/DL/PAN/Visa) + upload scans | 04 `GuestId` + `IdType` + `scanObjectKey`; Aadhaar masked default | ✅ / ❗ full-Aadhaar flag = client call |
| Additional (Company/GST/Purpose/Special Requests/Food/Medical/Preferred Room/Floor) | 04, `Guest.*` | ✅ |
| Guest history always available | 05 | ✅ |

## §4 Guest History
| Requirement | Covered by | Status |
|---|---|---|
| Visits, Room Nights, Revenue, Preferred Room/Rate, Payment/Feedback History, Previous Bills, Outstanding | 05 (derived) + `GuestStatsSnapshot` | ✅ |
| **Search by Name/Mobile/Email/Company/City/GST/Booking Source/ID Number** | 15 — **City, Booking Source, ID Number were missing** | 🔧 added to 15 (FR-1) + schema (`Guest.city` index, `GuestId.valueHash`) |

## §5 Billing & Invoicing
| Requirement | Covered by | Status |
|---|---|---|
| Invoice < 1 minute | 06 NFR (< 3s render), NFR budget | ✅ |
| Charges: Room/Food/Laundry/Airport/Taxi/Kitchen/Extra Bed/Misc/GST | 06 `ChargeType` enum (all) | ✅ |
| Payment modes: Cash/Credit/Debit/UPI/Bank/Online/Credit(Corporate) | 06 `PaymentMode` enum (all 7) | ✅ |
| Split payment | 06 FR-8 (`settlementBatchId`) | ✅ |
| GST invoice generation | 06 FR-12/16, `Invoice` + `InvoiceSeries` | ✅ |

## §6 Expense Management
| Requirement | Covered by | Status |
|---|---|---|
| Heads: Housekeeping/Kitchen/Maintenance/Utilities/Staff/Administration/Misc + subcategories | 07 `ExpenseHead` enum + `subCategory` | ✅ |
| Daily/Monthly/Property-wise/Category-wise | 07 FR-5 rollups | ✅ |

## §7 Income vs Expense Reports
| Requirement | Covered by | Status |
|---|---|---|
| Daily/Monthly/Property Profit | 08 | ✅ |
| Occupancy %, ARR, RevPAR | 14 metric library (`reporting.md`) | ✅ |
| Revenue by Booking Source/Corporate/Travel Agent | 08/25 segmentation | ✅ |

## §8 Staff Management
| Requirement | Covered by | Status |
|---|---|---|
| Employee details (Name/Mobile/Address/Dept/Salary/Joining/Aadhaar/PAN/Bank) | 09 `Staff.*` (PII masked) | ✅ |
| Attendance (check-in/out/working hours/leave/overtime) | 09 `Attendance` | ✅ |
| Salary calculation | 21 payroll (from 09) | ✅ |

## §9 Housekeeping
| Requirement | Covered by | Status |
|---|---|---|
| Room cleaning status, Linen/Towel change, Maintenance required, Guest complaints | 10 `HousekeepingTask` (+linen/towel/complaint fields) | ✅ |
| Update room status from mobile | 10 + 17 PWA offline | ✅ |

## §10 Maintenance
| Requirement | Covered by | Status |
|---|---|---|
| AC/Electrical/Plumbing/Furniture/Painting/Pest Control records | 11 `MaintenanceJob.category` | ✅ |
| Preventive maintenance reminders | 11 FR-4 (schedule → `MaintenanceScheduled` → 12) | ✅ |

## §11 Guest Communication Automation
| Requirement | Covered by | Status |
|---|---|---|
| Before Arrival (confirmation/map/check-in instructions) | 12 automations | ✅ |
| During Stay (welcome/Wi-Fi/rules/emergency) | 12 | ✅ |
| After Check-out (thank-you/review/feedback/invoice) | 12 | ✅ |
| Marketing (birthday/anniversary/festival/offers/promos/coupons) | 12 (consent-gated) | ✅ |
| Channels: WhatsApp/Email/SMS(optional) | 12 `Channel` enum + provider abstraction | ✅ / ❗ live = BSP/DLT/DKIM |

## §12 Booking Channel Integration
| Requirement | Covered by | Status |
|---|---|---|
| Record bookings from Direct/Phone/Walk-in/Corporate/Agents/Airbnb/Booking.com/Agoda/MMT/Goibibo | 03 sources + 13 connectors | ✅ |
| Integrate channel managers to avoid double bookings | 13 (one availability truth) | ✅ / ❗ live = OTA certification/aggregator |

## §13 Reports & Analytics (dashboard)
| Requirement | Covered by | Status |
|---|---|---|
| Today's check-ins/outs, vacant/occupied, revenue/expenses today, pending payments, advance/cancelled bookings | 14 live tiles | ✅ |
| Monthly occupancy, revenue trends, top corporates/agents, repeat guests | 14 trends/segments | ✅ |

## §14 Search & Data Retrieval
| Requirement | Covered by | Status |
|---|---|---|
| Search by Name/Mobile/Email/Company/GST/Booking ID/Invoice/Date Range/Platform/Property | 15 FR-1 | ✅ |
| Extremely fast retrieval | 15 NFR p95 < 500ms + indexes | ✅ |
| Export Excel/PDF/CSV | 15 FR-4 (`ExportJob`) | ✅ |

## §15 User Access Control
| Requirement | Covered by | Status |
|---|---|---|
| Roles: Admin/Manager/Reception/Accounts/Housekeeping/Maintenance | 16 + `RoleName` + rbac-matrix (37 permissions) | ✅ |
| Each user only accesses authorised modules | 16 server-side RBAC + property scope | ✅ |

## §16 Mobile Application
| Requirement | Covered by | Status |
|---|---|---|
| Works on Windows/Android/iPhone/Tablet | 17 PWA (ADR-0004) | ✅ |
| Data syncs instantly | 17 LISTEN/NOTIFY→SSE + offline queue | ✅ |

## §17 AI Features
| Requirement | Covered by | Status |
|---|---|---|
| Chatbot, auto WhatsApp/email replies, rate suggestions, sentiment, revenue forecast, expense trends, payment reminders, segmentation, NL search | 18 (all) + 24 (rates) + 12 (replies) | ✅ / ❗ needs LLM key for live (mock default) |

## §18 Security & Backup
| Requirement | Covered by | Status |
|---|---|---|
| Daily cloud backup | 00 `BackupRun` + job | ✅ |
| 2FA (optional) | 00 TOTP | ✅ |
| Data encryption | security.md + PII encryption | ✅ |
| Audit trail (who changed what) | 00 `AuditLog` (append-only) | ✅ |
| Role-based access control | 16 | ✅ |

## §19 Future Expansion (built now)
| Requirement | Covered by | Status |
|---|---|---|
| Multiple properties / branches | 01 tenancy | ✅ |
| Restaurant/POS | 19 | ✅ |
| Inventory management | 20 | ✅ |
| Payroll | 21 | ✅ |
| Accounting (Tally/Zoho) | 22 | ✅ / ❗ live = client account |
| Online booking engine | 23 | ✅ |
| Dynamic pricing | 24 | ✅ |
| CRM for corporate sales | 25 | ✅ |
| API integration with OTAs & payment gateways | 13 + 06/23 payment provider | ✅ |

## Objective & Expected Outcome
Reduce manual work, complete guest DB, simplify billing, expenses, reports, automate comms, multi-property, learnable by non-technical staff → covered across product.md + all modules; mobile-first + minimal-training baked into mobile-first.md + every spec's UX.

## Gaps found this review pass
1. 🔧 **Canonical schema was v1 with 22 modules' additions unapplied** → finalized `prisma/schema.prisma` (all deltas folded in).
2. 🔧 **Search facets City / ID Number / Booking Source (§4) missing from 15** → added to 15 spec + schema (`Guest.city` index, `GuestId.valueHash`, source filter).
3. 🔧 **No consolidated module-connectivity map** → added `docs/architecture/module-connectivity.md`.
4. ❗ **Open (client), documented in `schema-deltas.md`:** Aadhaar full-storage flag; live provider choices (WhatsApp BSP/SMS DLT/payment gateway/Tally-vs-Zoho); OTA certification vs aggregator; payroll statutory PF/ESI/PT/TDS auto-calc; POS table-mgmt/KDS/printers scope; inventory procurement/PO scope.

**Conclusion:** all 19 client sections + Objective/Outcome are traceable to specs. Remaining items are external/business decisions (❗), not documentation gaps.
