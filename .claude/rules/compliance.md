# Compliance (India)

Decision pending client sign-off: **build with the strict/masked defaults below**, gated behind a config flag so the client's legal call can relax it before go-live. Never weaken these silently.

## DPDP Act 2023 (Digital Personal Data Protection)
- Collect only what a purpose needs; state the purpose. Guest PII is processed to deliver the stay + legally required record-keeping.
- **Data residency:** host DB, backups, and object storage in an **India region** (e.g. `ap-south-1`).
- Rights support: be able to **export** and **erase** a guest's personal data on request (soft-delete + PII scrub, preserving legally-required financial records in anonymized form).
- Encryption at rest + in transit; access-logged; least-privilege access to PII.

## Aadhaar / UIDAI
- **Default: store only masked Aadhaar** (last 4 digits) as identity reference. Full number/scan only if `COMPLIANCE_STORE_FULL_AADHAAR` is enabled by the client with acknowledged risk.
- Aadhaar scans (if stored) live in access-controlled object storage, encrypted, never in the DB row, never in logs, never returned to low-privilege roles.
- Prefer alternative ID (passport/DL/voter) where the guest offers one; Aadhaar is not mandatory to create a guest.

## FRRO / Form C (foreign nationals)
- Every foreign guest's arrival is reportable to the FRRO/FRO via **Form C**. Captured at check-in when a PASSPORT/VISA id is on file (module 03 FR-24–26): a **masked** snapshot + a PDF in encrypted object storage — full passport/visa numbers stay encrypted on `GuestId`, never on `CForm`, never in the PDF, never in logs.
- Submission is **tracked, not auto-filed**: staff submit on the e-FRRO portal and record the reference (`GENERATED → SUBMITTED`). Auto-submission needs certified Bureau of Immigration access (a live blocker per `integrations.md`) — build the adapter behind an interface, never imply we can bypass certification.
- The Form C register is `reservation:view`; it never exposes ID numbers (nationality only).

## GST / financial records
- GST invoices comply with `business-rules.md` §10–13. Retain invoices/folios for the statutory period; never hard-delete.
- Support GST return-friendly exports (GSTR-relevant fields) from `22-accounting-sync` / `15-search-export`.

## Config flags (single place: `lib/constants/compliance.ts`)
- `COMPLIANCE_STORE_FULL_AADHAAR` (default off)
- `PII_MASK_IN_LISTS` (default on — masked in tables/exports unless permission + reason)
- `DATA_REGION` (default `ap-south-1`)

## Rule for every PII touch
Ask: is this field needed here, for this role, for this purpose? If not — don't fetch it, don't show it, don't log it.
