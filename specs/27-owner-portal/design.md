# 27 · Owner Portal — Design

## Architecture
Feature module `src/features/owner-portal/` on the existing modular monolith. **Reuses** the `(dashboard)` app shell + Auth.js session + `lib/permissions` RBAC + `lib/storage` + `lib/audit` + `lib/events`. Read surfaces call **existing** query layers (`reports`, `analytics`, `reservations`, `maintenance`); this module owns only the new writes (fee %, documents, important dates, payouts). Layers per `architecture.md`: pure payout math in `domain/`, orchestration in `actions.ts`, reads in `queries.ts`.

```
owner-portal/
  domain/payout.ts        pure: computePayout(revenue, expenses, feeBps) → {feePaise, netPaise}
  actions.ts              setManagementFee, uploadOwnerDocument, deleteOwnerDocument,
                          createImportantDate, deleteImportantDate, recordOwnerPayout, markPayoutPaid
  queries.ts              ownerFinancials, listOwnerDocuments, getOwnerDocumentBytes,
                          listImportantDates, ownerSchedule, listOwnerPayouts, getPayoutStatementBytes
  schema.ts               zod for every input
  components/             owner-home, document-vault, schedule-view, payout-list (+ manage widgets)
  statement.tsx           @react-pdf payout statement (money via reporting figures)
```

## Data model (Prisma) — module owns these
```prisma
model PropertyDocument {
  id            String    @id @default(cuid())
  propertyId    String
  category      String            // AGREEMENT | LICENCE | TAX | STATEMENT | OTHER
  title         String
  objectKey     String            // encrypted object storage
  checksum      String
  sizeBytes     Int
  contentType   String
  uploadedById  String
  uploadedByRole String           // OWNER | STAFF
  createdAt     DateTime  @default(now())
  deletedAt     DateTime?
  @@index([propertyId, deletedAt])
}

model PropertyImportantDate {
  id         String   @id @default(cuid())
  propertyId String
  kind       String            // LICENCE | GST | AMC | INSURANCE | OTHER
  label      String
  dueDate    DateTime @db.Date
  notes      String?
  createdAt  DateTime @default(now())
  deletedAt  DateTime?
  @@index([propertyId, dueDate])
}

model OwnerPayout {
  id                 String   @id @default(cuid())
  propertyId         String
  periodMonth        DateTime @db.Date   // first day of the month
  grossRevenuePaise  BigInt
  expensePaise       BigInt
  managementFeeBps   Int
  managementFeePaise BigInt
  netPayablePaise    BigInt              // may be negative (loss month)
  status             String   @default("COMPUTED") // COMPUTED | PAID
  paidAt             DateTime?
  paymentRef         String?
  recordedById       String
  createdAt          DateTime @default(now())
  @@unique([propertyId, periodMonth])    // idempotent record (FR-12)
  @@index([propertyId, periodMonth])
}
```
Plus `Property.managementFeeBps Int @default(0)`. No new owner↔property table — an owner is a user with `OWNER` role assigned to their properties via the existing assignment mechanism.

## Financials authorization (gotcha)
`ownerFinancials` authorizes on **`owner:view-financials` + property scope** — it must NOT call a report **action** that internally requires `report:view-financial` (owners don't hold it, and would be wrongly denied). It reaches the numbers through the reports/analytics **computation layer** (the same domain/query functions the report actions wrap) under the owner's own permission, or a shared helper that takes an already-authorized scoped client. Same figures, owner-appropriate guard.

## Domain — payout math (pure, unit-tested)
```ts
// all paise; feeBps in basis points; Decimal.js round half-up
export function computePayout(revenuePaise: bigint, expensePaise: bigint, feeBps: number):
  { managementFeePaise: bigint; netPayablePaise: bigint }
// fee = round_half_up(revenue × feeBps / 10000); net = revenue − expense − fee (net may be < 0)
```
Revenue/expense come from `reports.profitReport` (canonical `reporting.md`), never recomputed here.

## RBAC
Add to `RoleName`: `OWNER`. Add permissions to the map:
- OWNER: `owner:view-financials`, `owner:view-payout`, `owner:view-schedule`, `owner:view-docs`, `owner:upload-docs`.
- ADMINISTRATOR: all owner perms **+** `owner:manage` + `owner:payout-manage`. MANAGER: `owner:manage`.
Every action calls `authorize(user, perm, propertyId)`; every owner read is property-scoped via `db.scoped(user)`. Owner scope resolves to owned properties only.

## Routes (`(dashboard)`, permission-filtered nav)
- `/owner` — owner home (financials KPIs + trend).
- `/owner/documents` — vault (list/upload/download/delete).
- `/owner/documents/[docId]` — GET stream (authorized, non-public).
- `/owner/schedule` — important dates + maintenance + occupancy calendar.
- `/owner/payouts` — statements list; `/owner/payouts/[payoutId]` — GET statement PDF.
- **Management widgets** live in the existing property detail (`/properties/[id]`): set management-fee %, manage important dates, upload owner docs, compute/record/mark-paid payouts (gated by `owner:manage` / `owner:payout-manage`).

## Events & audit
New catalog events (not broadcastable — no SSE): `PropertyDocumentUploaded`, `PropertyDocumentDeleted`, `ImportantDateChanged`, `OwnerPayoutRecorded`, `OwnerPayoutPaid`. Document download/delete + payout record/pay + fee change all write audit rows.

## Sequences
**Record payout:** authorize `owner:payout-manage` → `profitReport(property, month)` for revenue+expense → `computePayout` → `$transaction`: insert `OwnerPayout` (unique `(property,month)`; conflict = idempotent no-op) → `OwnerPayoutRecorded` + audit.
**Owner upload:** authorize `owner:upload-docs` → storage `put` (encrypted) → insert `PropertyDocument` (`uploadedByRole=OWNER`) → `PropertyDocumentUploaded` + audit.
**Owner download:** authorize `owner:view-docs` + scope → storage `get` → stream; audit access.

## Testing
- Unit: `computePayout` (fee %, rounding half-up, loss month negative, zero fee).
- Integration: owner financials == reports figures; record payout idempotent + snapshot; mark-paid lifecycle; doc upload/download/delete rules + access audit; important-date CRUD.
- RBAC: owner scoped to owned property only (AC-2), owner cannot manage/payout (AC-19), reception denied (AC-18), owner cannot delete staff docs (AC-9).
- E2E (mobile): owner signs in → home → download a document → view payout statement.

## Reuse (do NOT rebuild)
`reports.profitReport` / `analytics` (financials + payout numbers), `reservations.reservationCalendar` (occupancy), `maintenance` preventive schedule, `lib/storage` (encrypted vault + statement PDF), `@react-pdf` (statement, like invoice/payslip/Form-C), `lib/audit`, `lib/events`, `db.scoped`.
