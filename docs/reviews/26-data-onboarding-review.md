# /review-module — 26-data-onboarding

**Date:** 2026-08-03 · **Reviewer:** implementing engineer (self-review, per DoD § Review)
**Built by:** delegated subagent (parallel Tier-7 batch); **integrated + verified serially by the parent.**
**Depends on:** 04 (`createGuest`), 03 (`createFromChannel`/`checkIn`/`checkOut`), 06 (`ensureDirectSaleFolio`/`postFolioCharge`), 00 (storage/events).
**Tier 7.** Owns `ImportBatch`, `ImportRow`. **No foreign INSERTs** — all targets via 04/03/06.

## 1. Traceability — AC → test
**20 unit** + **12 integration** + **2 e2e**.

| AC | Requirement | Covered by |
|---|---|---|
| AC-1/2 | template + createBatch (DRAFT + rows) | integration · e2e |
| AC-3 | RBAC non-admin denied | integration · e2e |
| AC-4/5 | dry-run classify + **no target writes** | integration (asserts guest.count===0) · `validate`/`dedup-plan` unit |
| AC-6 | error report = ERROR rows only | integration |
| AC-7 | commit GUESTS via 04 + targetId + `ImportCommitted` | integration · e2e |
| AC-8 | commit guard: DRAFT / un-skipped ERROR rejected | integration (rejected) |
| AC-9/13 | RESERVATIONS → CHECKED_OUT via 03; `GUEST_UNMATCHED` / `UNKNOWN_MASTER_DATA` | integration |
| AC-10 | BALANCES → opening-balance FolioLine via 06 | integration |
| AC-11 | idempotent re-commit → 0 created | integration · `import-key` unit |
| AC-12 | rollback: committed → soft-void via targetId; uncommitted → discard | integration |
| AC-14 | Aadhaar masked, no scans, file access-controlled | integration · `normalize` unit |
| AC-15 | large-file pg-boss validate job | integration (headless via assembleClaims) |

## 2. Invariants
| Invariant | Status |
|---|---|
| No foreign INSERTs | ✅ GUESTS→`04.createGuest`, RESERVATIONS→`03.createFromChannel`+checkIn/out, BALANCES→`06.postFolioCharge` |
| Dry-run side-effect-free | ✅ validate writes only classification to ImportRow; asserts zero target rows |
| Idempotent | ✅ natural `importKey`; re-commit creates 0; commit skips already-stamped rows |
| Commit guarded | ✅ DRAFT or any ERROR row → rejected (fix-file + re-upload workflow) |
| PII/compliance | ✅ Aadhaar masked before persist; file in encrypted access-controlled storage; nothing sensitive logged |

## Decisions
- **D-1:** `autoMappingForTemplate` maps file headers against the template's **descriptive labels** ("Guest mobile" → field `mobile`), not the field keys — fixed at merge (the key-match only worked for GUESTS).
- **D-2:** RESERVATIONS use `03.createFromChannel` (past-date-tolerant) then checkIn→checkOut to reach CHECKED_OUT; rollback of a terminal reservation is a documented no-op.

## Carried risks
- **R-45 (largest):** the **large-file pg-boss commit** path is a follow-up — 04/06 create actions call `requireUser()`, so GUESTS/BALANCES commit runs reliably **inline** (admin session; chunked + progress-persisted); validate runs headless. A system-context variant of 04/06 would complete the async-commit path.
- **R-46:** BALANCES opening line posts via 06's `MISC` charge type (18% GST) — the **principal** reconciles exactly; a GST-exempt opening-balance option in 06 would make the tax-inclusive outstanding match exactly.
- **R-47:** mobile/email remain in `ImportRow.raw` for matching/preview (admin-only, purged on rollback) — a documented trade-off; Aadhaar is masked.
