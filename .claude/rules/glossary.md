# Glossary (Ubiquitous Language)

Use these terms exactly — in code, specs, and UI. One concept, one word.

| Term | Meaning |
|---|---|
| **Property** | A physical hotel/apartment building the org operates. Top of the tenancy tree. |
| **Room / Unit** | A sellable accommodation within a property. |
| **Room Category** | A class of rooms sharing tariff/attributes (e.g. Deluxe, Suite). |
| **Room Status** | Vacant · Occupied · Reserved · Under-Maintenance · Housekeeping. |
| **Availability** | Whether a room/category can be sold for a date range; the single anti-overbooking truth. |
| **Reservation / Booking** | A guest's intent to occupy a room for dates. Has a lifecycle (Enquiry→Confirmed→In-House→Checked-Out / Cancelled / No-Show). |
| **Booking Source** | Where a reservation came from (Direct, Website, Phone, Walk-in, Airbnb, Booking.com, Agoda, MakeMyTrip, Goibibo, Corporate, Travel Agent). |
| **Guest** | A permanent person record in the CRM; reservations reference it. |
| **Folio** | The running account of one reservation: all charges + payments as immutable lines. Balance is derived. |
| **Charge / Line item** | A single posted amount on a folio (room, F&B, laundry, transfer, taxi, extra bed, POS, misc), append-only. |
| **Tariff / Rate** | The price of a room-night before discount/tax. |
| **ADR / ARR** | Average Daily/Room Rate = room revenue ÷ occupied room-nights. |
| **RevPAR** | Revenue per available room = room revenue ÷ available room-nights. |
| **Occupancy %** | Occupied ÷ available room-nights. |
| **Room-night** | One room sold for one night; the unit of occupancy and history. |
| **Night Audit** | The nightly per-property close: posts room charges, rolls the business date, snapshots stats, locks the day. |
| **Business Date** | The property-local operating day a transaction belongs to (may differ from wall-clock after midnight until night audit). |
| **GST invoice** | A statutory tax invoice with sequential number, GSTIN, HSN/SAC, tax breakup. |
| **CGST/SGST/IGST** | GST components: intra-state splits into CGST+SGST; inter-state is IGST. |
| **Expense Head** | A category of spend (Housekeeping, Kitchen, Maintenance, Utilities, Staff, Administration, Misc). |
| **Domain Event** | An immutable record that something happened (`ReservationCreated`, `PaymentReceived`…). Drives comms/AI/analytics. |
| **Channel Manager** | A system that syncs availability/rates/reservations with OTAs. |
| **Outbox / Inbox** | Reliable messaging patterns for outbound/inbound integration events. |
| **PII** | Personal data (name, contact, Aadhaar, passport…) governed by `compliance.md`. |
| **Property scope** | The set of properties a user may access; every query is filtered by it. |
