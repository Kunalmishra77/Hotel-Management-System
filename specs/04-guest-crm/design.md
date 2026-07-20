# 04 · Guest CRM — Design

## Schema slice (from canonical `prisma/schema.prisma`)
Owns `Guest`, `GuestId`, enum `IdType`. Indexes `(orgId, mobile)`, `(orgId, email)`, `(orgId, gstNumber)`; add a trigram/normalized index for `fullName` search (see Schema notes). PII columns (mobile/whatsapp/email/address, `medicalNotes`, `GuestId.encryptedValue`) are **application-encrypted**; `GuestId.maskedValue` is plaintext-safe. Scans: object storage only.

**Schema notes — confirmed present in canonical schema** (migration materializes indexes, but nothing here is "new"):
- Keyed hash columns for exact-match search without decrypting — **`Guest.mobileHash`, `Guest.emailHash`, `GuestId.valueHash`** — are present, with non-unique indexes `@@index([orgId, mobileHash])`, `@@index([orgId, emailHash])`, `@@index([type, valueHash])`. (There is **no** unique constraint on a contact token.)
- **`Guest.mergedIntoId`** (nullable) records merge lineage — present.
- Fast fuzzy name search: the migration adds a **`pg_trgm` GIN index on `fullName`** (schema-commented at the `Guest` model; database-setup.md) for FR-10 p95<500ms — an index the migration materializes, not a new column.

## Domain layer (pure) — `features/guests/domain/`
- `normalizePhone(raw)`, `normalizeEmail(raw)` — for dedupe + search tokens.
- `maskAadhaar(value)` / `maskContact(value, kind)` — masking rules.
- `duplicateScore(candidate, existing)` — match on normalized mobile/email/ID → probable-duplicate decision (FR-5).
- `mergeFields(survivor, loser)` — deterministic field-combination rule (FR-12).

## Application — server actions (`features/guests/actions.ts`)
Per `api-conventions.md`: zod → authorize → transaction → event + audit.
- `createGuest(input, {confirmDuplicate?})` — `guest:create`. Runs `duplicateScore` under a per-`(orgId, contact-token)` advisory lock (serializes the create-vs-create race — no unique DB constraint exists); returns `DUPLICATE_GUEST` + candidates unless `confirmDuplicate` (create-anyway). (FR-5)
- `updateGuest(id, patch)` — **`guest:manage`** (create+update per rbac-matrix); re-runs dedupe on contact change and recomputes `mobileHash`/`emailHash`.
- `addGuestId(guestId, {type, value, scan?})` — enforces Aadhaar masking + full-value gating (FR-3/4); sets `valueHash`/`encryptedValue` per policy; uploads scan to storage (FR-7).
- `revealPii(guestId, field, reason)` — `guest:view-pii`; returns value, emits `GuestPiiAccessed` + audit. (FR-9)
- `mergeGuests(survivorId, loserId)` — **`guest:merge`** (🔒); atomic re-point + set loser `mergedIntoId` + soft-delete + `GuestMerged` (05 recomputes both). (FR-12)
- `exportGuestData(guestId)` — `export:pii`; portable file; audited. (FR-13)
- `eraseGuest(guestId)` — `guest:delete`; scrub personal fields **and clear `mobileHash`/`emailHash`/`GuestId.valueHash`/`GuestId.encryptedValue`** + purge scans, preserve financials, reject if active reservation. (FR-14)

## Queries (`features/guests/queries.ts`)
- `searchGuests(q, filter)` — multi-field, scoped, cursor-paginated, PII masked by default; uses the search index. (FR-10)
- `getGuestProfile(id)` — masked unless caller has reveal permission.

## UI — wireframes (mobile-first, `features/guests/components/`)

**Guest search / list (PII masked):**
```
┌───────────────────────────┐
│ Guests        [+ New]     │
│ [🔍 name / mobile / GST ] │
│ ┌───────────────────────┐ │
│ │ Ravi Kumar            │ │
│ │ 📞 98xxxxxx01  Blr    │ │
│ │ 3 stays · ₹42k        │ │
│ └───────────────────────┘ │
│ ┌───────────────────────┐ │
│ │ Anita Mehta · ACME    │ │
│ └───────────────────────┘ │
└───────────────────────────┘
```
**Guest profile:** tabs Profile · IDs · History(05) · Preferences. Masked contact shows a 👁 "Reveal" that prompts for a **reason** (only if permitted) before unmasking.
**New-guest with dedupe:** on save, if duplicate → a sheet lists candidates with "This is the same guest (open)" / "Merge" / "Create anyway".

## Events
Emits: `GuestCreated`, `GuestUpdated`, `GuestIdAdded`, `GuestPiiAccessed`, `GuestMerged`, `GuestErased`, (joint) `GuestCheckedIn`. Consumed by 05/12/14/18. Catalog: `docs/architecture/domain-events.md`.

## Sequences
**Create with dedupe:** validate → normalize → **acquire per-`(orgId, contact-token)` advisory lock** → `duplicateScore` → if probable dup & not confirmed → return candidates → (user confirms/merges, or create-anyway) → INSERT Guest (+`mobileHash`/`emailHash`) + event + audit → release lock.
**Reveal PII:** authorize `guest:view-pii` → require reason → decrypt field → return → emit `GuestPiiAccessed` + audit (single tx for the audit).
**Erase:** guard active reservation (via 03 query) → scrub personal fields → **null `mobileHash`/`emailHash` + each `GuestId.valueHash`/`encryptedValue`** (so the erased record is no longer searchable or recoverable) → purge scans (storage) → keep financial links anonymized → `GuestErased` + audit.

## Error catalog
`DUPLICATE_GUEST`, `AADHAAR_FULL_STORAGE_DISABLED`, `VALIDATION_FAILED`, `FORBIDDEN`, `ERASE_BLOCKED_ACTIVE_STAY`, `PII_REASON_REQUIRED`.

## Edge cases
- Two staff create the same guest concurrently → there is **no** unique contact-token constraint (only a non-unique index), so the race is serialized by a **per-`(orgId, contact-token)` advisory lock (or a serializable tx)** around detect-then-insert; the second caller sees the first and gets `DUPLICATE_GUEST` — while an explicit **create-anyway** still succeeds.
- Merge where both have reservations → all re-pointed; no reservation lost; folios remain valid.
- Guest with only Aadhaar offered while full-storage off → accept masked last-4; prompt for an alternative ID for full record if policy needs one.
- Reveal reason left blank → `PII_REASON_REQUIRED`.
- Export/erase of an already-merged (loser) guest → operate on the survivor.
