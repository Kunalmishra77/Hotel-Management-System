# 04 · Guest CRM — User Stories & Acceptance Criteria

Roles per `rules/user-roles.md`; PII rules per `rbac-matrix.md` + `compliance.md`.

## Test Fixtures
| Ref | Entity | Value |
|---|---|---|
| ORG | Organization | "Woodpecker Group" |
| G-RAVI | Guest | "Ravi Kumar", mobile `9800000001`, email `ravi@ex.com`, Bangalore |
| G-RAVI2 | Guest | "Ravi K", mobile `9800000001` (same number — a duplicate) |
| G-MEHTA | Guest | "Anita Mehta", company ACME, GSTIN present |
| ID-PP | GuestId | Passport for G-RAVI, full stored (allowed) |
| ID-AAD | Aadhaar | value `1234 5678 9012` → masked `XXXX XXXX 9012` |
| U-REC | User | RECEPTION (`guest:view`, `guest:create`; **no** `guest:view-pii`) |
| U-MGR | User | MANAGER (`guest:view-pii` with reason) |
| U-HK | User | HOUSEKEEPING (no guest access) |
| U-ADMIN | User | ADMINISTRATOR (`guest:delete`, `export:pii`) |

## US-1 — Create & maintain a guest
*As Reception, I want to create a guest fast, so I can check them in.*
- **AC-1:** Given U-REC, when creating G-RAVI with fullName + mobile, then a permanent `Guest` (scoped to ORG) is created; `GuestCreated` emitted + audited. (FR-1/2/11)
- **AC-2:** Given no mobile (or an invalid one), when saving, then rejected at validation; nothing persists. (FR-6)
- **AC-3:** Given G-RAVI exists (mobile `9800000001`), when creating G-RAVI2 with the same mobile, then `DUPLICATE_GUEST` with G-RAVI as a candidate; the user must confirm "create anyway" or **merge** — no silent second record. (FR-5)

## US-2 — Government IDs & Aadhaar
- **AC-4:** Given a passport, when added, then a `GuestId(PASSPORT)` persists with masked value; full value stored (allowed for passport). (FR-3)
- **AC-5:** Given `COMPLIANCE_STORE_FULL_AADHAAR` = off (default), when adding Aadhaar `1234 5678 9012`, then only `XXXX XXXX 9012` is stored; an attempt to store the full number or an Aadhaar scan is rejected; the guest is still creatable without Aadhaar. (FR-4)
- **AC-6:** Given an ID scan upload (allowed type), when stored, then it lands in encrypted India-region object storage and the row keeps only `scanObjectKey` + `scanChecksum`; no bytes/number in logs. (FR-7)

## US-3 — PII masking & reveal
- **AC-7:** Given any front-desk role, when viewing a guest list/search, then contact + ID values are **masked by default** (masking is the default view for everyone — reveal is a separate per-field action), but `fullName` is visible. (FR-8)
- **AC-8:** Given U-MGR, when revealing G-RAVI's full mobile with a reason, then the value returns AND `GuestPiiAccessed` + an audit row (who/guest/field/reason) are written. (FR-9)
- **AC-9:** Given U-HK (a role **without** `guest:view-pii` — see `docs/architecture/rbac-matrix.md`), when calling the reveal action, then `FORBIDDEN` (403). Reception/Manager/Accounts **do** hold `guest:view-pii` at the audited (🔒) tier — front desk legitimately needs a guest's contact — so for them reveal succeeds **with a reason** and is audited (as AC-8); it is never silent. (FR-8/9) *(Corrected in the 04 review: an earlier draft wrongly assumed Reception lacked this permission, contradicting the RBAC matrix.)*

## US-4 — Search
- **AC-10:** Given 100k seeded guests, when U-REC searches "9800000001" or "Ravi" or "ACME" or a GSTIN, then matching guests return org/property-scoped, cursor-paginated, **p95 < 500ms**, with PII masked. (FR-10)

## US-5 — Merge duplicates
- **AC-11:** Given G-RAVI and G-RAVI2 confirmed duplicates, when a `guest:merge` holder merges them, then a survivor is chosen, fields combined by the deterministic rule, all `Reservation`/`Feedback`/history re-pointed to the survivor, the loser's `mergedIntoId` set to the survivor + soft-deleted, `GuestMerged` emitted (05 recomputes **both** survivor and loser) — atomic + audited (🔒). (FR-12)

## US-6 — DPDP export & erasure
- **AC-12:** Given U-ADMIN (`export:pii`), when exporting G-RAVI, then a portable file with profile + ID metadata + stay references is produced and the export is audited. (FR-13)
- **AC-13:** Given U-ADMIN (`guest:delete`) and G-RAVI has no active reservation, when erasing, then personal fields are nulled/tokenized **and `mobileHash`/`emailHash`/every `GuestId.valueHash`+`encryptedValue` are cleared** (so the record is no longer searchable or recoverable), scans purged from storage, but folios/invoices remain in anonymized-linked form; `GuestErased` audited. (FR-14)
- **AC-14:** Given G-RAVI has an IN_HOUSE reservation, when erasure is attempted, then rejected until the stay is closed. (FR-14)

## Permission / negative / security
- **AC-15:** Given U-HK, when calling any guest read/write action, then `FORBIDDEN` (403) regardless of UI. (FR-15)
- **AC-16:** Assert no guest PII appears in logs, SSE payloads, or responses to roles lacking permission. (FR-16)
