# /review-module — 04-guest-crm

**Date:** 2026-07-23 · **Reviewer:** implementing engineer (self-review, per DoD § Review)
**Depends on:** 00-platform ✅ · 01-property-management ✅ · 02-room-inventory ✅
**Tier 1, first module.** Unblocks 03-reservations (references `Guest`) and 05-guest-history.

Checklist source: [`.claude/commands/review-module.md`](../../.claude/commands/review-module.md)

This is the **PII-critical** module: the sole writer of `Guest`/`GuestId` and the only gate for
guest-PII exposure (Aadhaar masking, reveal-with-reason, DPDP export/erase).

---

## 1. Traceability — every AC → a passing test

All **16** acceptance criteria in
[`specs/04-guest-crm/user-stories.md`](../../specs/04-guest-crm/user-stories.md) map to at least one
named test. Unit: `normalize` (14), `dedupe` (12), `masking` (10), `storage` (11). Integration:
`guests` (24). E2E: `guests` journey (mobile viewport).

| AC | Requirement | Covered by |
|---|---|---|
| AC-1 | Create guest, ORG-scoped, `GuestCreated` + audit | `guests` (create, encrypted+token) · e2e |
| AC-2 | Missing/invalid mobile rejected at validation | `guests` (validation) — `VALIDATION_FAILED` |
| AC-3 | Same-mobile create → `DUPLICATE_GUEST` w/ candidate, confirm/merge | `guests` (dedupe + create-anyway + **concurrent race**) · e2e (dedupe sheet) |
| AC-4 | Passport stored, full value (allowed), masked | `guests` (addGuestId passport) · e2e |
| AC-5 | Aadhaar → last-4 only; full value + scan rejected while flag off | `guests` (Aadhaar gating, scan reject) · e2e (masked ID) |
| AC-6 | Scan → encrypted India-region storage, row keeps key+checksum only | `storage` (encrypted put, region guard) · `id-actions` (scan-before-write) |
| AC-7 | List/search masked, `fullName` visible | `guests` (search masked, profile masked) · e2e |
| AC-8 | Reveal w/ reason → value + `GuestPiiAccessed` + audit (who/field/reason) | `guests` (Manager reveal, audit asserted, value not in audit) · e2e (audited) |
| AC-9 | Role **without** `guest:view-pii` (U-HK) → 403 | `guests` (Housekeeping denied all) — **see D-2** |
| AC-10 | Search by mobile/name/company/GSTIN, scoped, paginated, masked, p95<500ms | `guests` (all four query paths) — **p95 deferred, R-4** |
| AC-11 | Merge: survivor, field-combine, re-point, loser `mergedIntoId`+soft-delete, `GuestMerged` 🔒 | `guests` (merge re-point + lineage) |
| AC-12 | Export gated + audited | `guests` (admin export, audited; denied w/o `export:pii`) |
| AC-13 | Erase scrub **+ clear all hash tokens / encryptedValue**, purge scans, keep financials | `guests` (**in-DB probe: tokens nulled**) |
| AC-14 | Erase rejected while an active stay exists | `guests` (IN_HOUSE → `ERASE_BLOCKED_ACTIVE_STAY`) |
| AC-15 | Housekeeping → 403 on every guest action | `guests` (create/reveal/merge/export/erase all 403) |
| AC-16 | No PII in logs / events / low-priv responses | `guests` (create/reveal assert value absent from event+audit; search serialized ≠ raw) |

---

## 2. Invariants

| Invariant | Status |
|---|---|
| PII encrypted at rest | ✅ `mobile`/`email`/`whatsapp` stored as AES-256-GCM envelopes (`v1.…`), never plaintext — asserted in-DB |
| PII searchable without decrypting | ✅ keyed HMAC `mobileHash`/`emailHash` tokens; exact-match search hits a btree index, no row decrypt |
| Masked by default | ✅ every list/search/profile path masks; raw value leaves the server only via `revealPii` (perm + reason + audit) |
| Aadhaar minimization | ✅ default stores last-4 only; full value **and** scan rejected unless `COMPLIANCE_STORE_FULL_AADHAAR` — asserted |
| Append-only / erase preserves financials | ✅ erase scrubs the `Guest`/`GuestId` PII + nulls tokens; folios/invoices untouched (soft-delete, not hard-delete) |
| Every mutation: event + audit | ✅ `GuestCreated/Updated/IdAdded/PiiAccessed/Merged/Erased` + audit row, all inside the tx |
| No overbooking-style race on create | ✅ `pg_advisory_xact_lock(org, token)` serializes concurrent same-mobile creates — **asserted** (exactly one of two wins) |

---

## 3. Security

- ✅ Every action: `zod.parse` → `authorize` (deny-by-default) → tx → event + audit → typed `Result`.
- ✅ Guests are **org-scoped**, not property-scoped, so they correctly use `db.unscoped()` with an
  explicit `orgId` filter in every query (a guest belongs to the org, visits many properties).
- ✅ Reveal/export/merge/erase are 🔒 audited; reveal and erase carry a **reason** enforced by
  `authorize` (`REASON_REQUIRED_PERMISSIONS`), re-checked server-side — the sheet's reason box is UX,
  not the guard.
- ✅ **The revealed value is never logged or audited** — the audit row carries who/guest/field/reason
  only; asserted by both integration and e2e (`JSON.stringify(audit).not.toContain(number)`).
- ✅ Dedupe candidates returned to the client are **masked** — a duplicate prompt is not a PII oracle.
- ✅ Guest events are **not** on the SSE broadcast allow-list — no guest PII crosses the realtime channel.

---

## 4. NFRs

- ✅ Search is a single indexed query: digit→`mobileHash` exact, `@`→`emailHash` exact, GSTIN-shape→
  `gstNumber`, else `fullName`/`companyName` **pg_trgm** trigram (the T-1 GIN migration). Cursor-paginated,
  `take+1` for next-page detection — never an unbounded scan.
- ✅ Mobile-first: search/list is a stacked tap-list (≥44px rows); new-guest + reveal + dedupe are
  bottom sheets in thumb reach; correct `inputmode` on mobile/email fields.
- ⚠️ **p95 < 500ms at 100k guests is NOT measured** — see R-4.

---

## 5. Architecture

- ✅ Domain (`normalize`, `dedupe`, `masking`) is pure — no I/O, unit-tested deterministically.
- ✅ Actions split by concern to stay ≤300 lines: `actions` (create/update), `id-actions`,
  `pii-actions` (reveal/export), `erase-actions`, `merge-actions`. Queries take claims explicitly.
- ✅ New infra built behind interfaces, sandbox-by-default: `lib/storage` (local encrypted sandbox +
  lazy S3, India-region guard) and `lib/constants/compliance` (config flags).
- ✅ No new dependency.

---

## 6. Data

- ✅ T-1 migration `20260722120000_guest_search_index` (pg_trgm GIN on `fullName`+`companyName`,
  partial `WHERE deletedAt IS NULL`) applied + verified.
- ✅ Seed idempotent: fixtures `G-RAVI`, `G-RAVI2` (duplicate), `G-MEHTA` (company+GSTIN); the
  `--scale` path (100k) is written and runnable, the timed run deferred (R-4). **F-2** fixed a seed
  idempotency bug found during testing.

---

## Decisions

### D-1 · `toResult` now maps `ZodError` → `VALIDATION_FAILED` (cross-cutting fix)
Every action validates with `schema.parse(input)`, which throws `ZodError` on bad input. `toResult`
special-cased only `DomainError`, so **every** invalid-input failure across all modules fell through
to an opaque `INTERNAL` (500) instead of a `VALIDATION_FAILED` (400) with field errors —
contradicting `api-conventions.md` ("reject invalid early", typed field errors). Fixed at the single
correct place: `toResult` now bridges `ZodError` to a typed 400 carrying per-field messages (keys
only, no values → no PII in the payload). Verified by the full 459-test regression; the AC-2
validation test now asserts the correct code.

### D-2 · Reception **holds** `guest:view-pii` (spec AC-9 corrected, not the code)
The spec draft's AC-9 asserted Reception gets 403 on reveal. The authoritative
[`rbac-matrix.md`](../architecture/rbac-matrix.md) grants Reception (and Manager/Accounts)
`guest:view-pii` at the audited 🔒 tier — front desk legitimately needs a guest's contact. The
`permission-map` matches the matrix; the spec was the divergence. **Resolution:** corrected AC-9 (and
AC-7's false "no view-pii" parenthetical) in `user-stories.md` to the true 403 case — a role
*without* the permission (Housekeeping/Maintenance, = AC-15) — and documented that Reception reveals
**with a reason, audited**. The integration tests assert the L-tier grant works and is audited, and
that Housekeeping is denied.

### D-3 · Advisory lock, not a unique constraint, for dedupe
A unique DB constraint on the contact token would make "create anyway" (FR-5) impossible. Instead a
transaction-scoped `pg_advisory_xact_lock(hashtext(org), hashtext(token))` serializes only concurrent
creates of the *same* contact, so the second create observes the first and returns the dedupe prompt
rather than silently racing past it. First advisory-lock precedent in the codebase.

### D-4 · Erase scrubs a non-nullable column to a sentinel
`Guest.mobile` is non-nullable (contact is required at create). Erase sets it to `"[erased]"` and
nulls `mobileHash`/`emailHash` (the search tokens) + every `GuestId.valueHash`/`encryptedValue`, so
the record is un-searchable and unrecoverable while satisfying the schema. An in-DB test probe
asserts the tokens are actually null after erase (AC-13) — not just that the action returned ok.

---

## Findings

### F-1 · Fixed · Validation errors surfaced as 500 (cross-cutting) — see D-1.

### F-2 · Fixed · Seed was not idempotent after an erase test
The `G-MEHTA` seed `update` branch reset `fullName`/`companyName`/`gstNumber` but not `mobile`/
`mobileHash`, so re-seeding after the erase test left an impossible row (`mobile="[erased]"` yet
`deletedAt=null`) that crashed `decryptOptional` in search. Fixed the update branch to restore every
field erase scrubs. (In production this state can't occur — an erased guest keeps `deletedAt` set and
is excluded from search — so the fix is purely test-fixture hygiene.)

### F-3 · Non-blocking · `mergeFields` / `updateGuest` re-dedupe have no dedicated UI
The merge action (re-point + lineage + `GuestMerged`) and its `mergeFields` rule are implemented and
tested; the merge is reachable from the dedupe sheet's "open existing" path but the full
side-by-side merge screen is deferred to when a real reconciliation workflow needs it (05 consumes
`GuestMerged` regardless). **Action:** add when guest-history surfaces it.

### F-4 · Non-blocking · Search decrypt is not resilient to a single corrupt row
`searchGuests` decrypts each row's contact to mask it; one malformed envelope throws for the whole
page. Acceptable because a corrupt envelope indicates data corruption and erased guests (the only way
to get a sentinel) are excluded by `deletedAt`. **Action:** if bulk import (26) can introduce
partial rows, wrap the per-row decrypt so one bad row degrades to `—` instead of failing the search.

---

## Carried risks

- **R-1** NFR latency budgets unmeasured (from 00; unchanged).
- **R-2** ≥90% domain coverage configured but not CI-enforced (from 00; unchanged).
- **R-3** Room-board p95 at 200 rooms unverified (from 02; unchanged).
- **R-4 (new)** The **AC-10 p95 < 500ms at 100k guests** budget is unverified — the default seed has
  3 guests. The query shape is right (indexed exact-match tokens + trigram GIN, cursor-paginated), and
  the `--scale` seed is written, but that is reasoning + a shape, not a measurement. Needs the
  `--scale` run and a timed search in staging. At 3 rows Postgres correctly prefers the `orgId` index
  over the GIN index; the switch to the trigram plan only happens at volume.
