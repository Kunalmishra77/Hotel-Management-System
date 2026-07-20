# 04 · Guest CRM — Tasks

Ordered, test-first for domain/PII. Each ends at `rules/definition-of-done.md`. `(AC-n)/(FR-n)` = traceability.

## Schema & migration
- [ ] T-1 Materialize the `Guest`/`GuestId` slice — `Guest.mobileHash`/`emailHash`, `GuestId.valueHash`/`encryptedValue`, and `Guest.mergedIntoId` are **confirmed present in canonical schema**; migration adds the **`pg_trgm` GIN index on `fullName`** for FR-10. (FR-10/12)
- [ ] T-2 Verify PII columns app-encrypted; masked columns plaintext-safe. **No unique contact-token constraint exists** (only non-unique `@@index([orgId, mobileHash])`/`([orgId, emailHash])`); guard the dedupe create-vs-create race with a **per-`(orgId, contact-token)` advisory lock (or serializable tx)** around detect-then-insert, preserving create-anyway. (FR-16, FR-5)
- [ ] T-3 Seed 100k+ guests + fixtures for search/dedupe tests.

## Domain (write tests first)
- [ ] T-4 `normalizePhone/normalizeEmail`. (FR-5/10)
- [ ] T-5 `maskAadhaar/maskContact`. (FR-4/8, AC-5/7)
- [ ] T-6 `duplicateScore` (mobile/email/ID). (FR-5, AC-3)
- [ ] T-7 `mergeFields` deterministic rule. (FR-12, AC-11)

## Application (integration tests)
- [ ] T-8 `createGuest` (`guest:create`) + advisory-lock dedupe gate + create-anyway + event + audit. (FR-1/2/5/11, AC-1/2/3)
- [ ] T-9 `addGuestId` Aadhaar masking + full-value gating + scan upload to storage. (FR-3/4/7, AC-4/5/6)
- [ ] T-10 `revealPii` permission + reason + `GuestPiiAccessed` + audit; denied without perm. (FR-8/9, AC-7/8/9)
- [ ] T-11 `mergeGuests` (**`guest:merge`** 🔒) atomic re-point + set loser `mergedIntoId` + soft-delete + `GuestMerged` (05 recomputes both). (FR-12, AC-11)
- [ ] T-12 `exportGuestData` gated + audited. (FR-13, AC-12)
- [ ] T-13 `eraseGuest` scrub + **clear `mobileHash`/`emailHash`/`GuestId.valueHash`/`encryptedValue`** + scan purge + financial preservation; reject if active stay. (FR-14, AC-13/14)
- [ ] T-14 RBAC: housekeeping/maintenance denied all guest actions. (FR-15, AC-15)
- [ ] T-15 Assert no PII in logs/SSE/low-priv responses. (FR-16, AC-16)

## Queries & UI (mobile-first)
- [ ] T-16 `searchGuests` multi-field, scoped, paginated, masked; p95<500ms budget test on 100k. (FR-10, AC-10)
- [ ] T-17 `getGuestProfile` masked-by-default.
- [ ] T-18 Guest search/list UI (masked). (AC-7/10)
- [ ] T-19 Guest profile tabs + reason-gated reveal. (AC-8)
- [ ] T-20 New-guest form + duplicate-resolution sheet (open/merge/create-anyway). (AC-3)

## E2E
- [ ] T-21 Journey: create guest → dedupe prompt → add ID (Aadhaar masked) → search → reveal with reason (audited). (AC-1/3/5/8/10)

## Done
- [ ] T-22 `/review-module` clean; every AC → green test; DoD satisfied.
