# /review-module — 00-platform

**Date:** 2026-07-21 · **Reviewer:** implementing engineer (self-review, per DoD § Review)
**Verdict:** ✅ **Pass, with 3 non-blocking findings and 2 carried risks.**
This module gates every other; Tier 1 (`01-property-management`) may start.

Checklist source: [`.claude/commands/review-module.md`](../../.claude/commands/review-module.md)

---

## 1. Traceability — every AC → a passing test

All **25** acceptance criteria in [`specs/00-platform/user-stories.md`](../../specs/00-platform/user-stories.md)
map to at least one named, passing test. No AC is untested.

| AC | Requirement | Covered by |
|---|---|---|
| AC-1 | Session issued, claim shape, bcrypt-only comparison | `auth-session` · `seed-fixtures` · e2e |
| AC-2 | 2FA withholds session; valid TOTP issues it | `auth-two-factor` · `totp` · e2e |
| AC-3 | Backup code single-use | `auth-two-factor` (incl. concurrent race) · `totp` |
| AC-4 | Lockout + non-enumerating error | `lockout` · `auth-session` · `auth-two-factor` · e2e |
| AC-5 | 2FA enrolment confirmed before activation | `auth-two-factor` |
| AC-6 | Reset token single-use, expiring, revokes sessions | `auth-two-factor` |
| AC-7 | No PII in claims | `auth-session` (runtime PII scan) |
| AC-8 | `db.scoped` returns only in-scope rows | `db-scoped` |
| AC-9 | Out-of-scope → FORBIDDEN pre-read | `db-scoped` · `authorize` |
| AC-10 | Admin scope is org-wide | `auth-session` · `db-scoped` · `permission-map` |
| AC-11 | Denied permission → 403 server-side | `authorize` · `permission-map` · **e2e (real HTTP 403)** |
| AC-12 | Permission refresh next request | `auth-session` |
| AC-13 | 🔒 action writes audit + reason | `audit-events` · `authorize` |
| AC-14 | Audit row in the same transaction | `audit-events` (incl. rollback) |
| AC-15 | Audit append-only | `audit-events` (DB trigger refuses UPDATE/DELETE) |
| AC-16 | Event persisted in same transaction | `audit-events` |
| AC-17 | Dispatch at-least-once, `dispatchedAt`, ordering | `audit-events` |
| AC-18 | Retry → dead-letter, row survives | `audit-events` |
| AC-19 | Idempotent consumers | `audit-events` |
| AC-20 | Inbox dedupe returns success | `audit-events` (incl. concurrent race) |
| AC-21 | Inbox processed exactly once | `audit-events` |
| AC-22 | Backup encrypted + `BackupRun` + alert | `backup` |
| AC-23 | Zero-credential sandbox fallback | `backup` |
| AC-24 | Auth gate + permission-filtered nav | `navigation` · e2e |
| AC-25 | Property switcher scoped, persists | `auth-session` · e2e |

**Beyond the unit/integration suite, the following were verified against a running build
and the live database**, not only mocked: the 307 auth redirect, a real password sign-in, a
real TOTP sign-in, a real **HTTP 403**, a real property switch persisting across navigation,
and the resulting `AuditLog` / `DomainEvent` rows queried back out of Postgres.

---

## 2. Invariants

| Invariant | Status |
|---|---|
| Money in paise + Decimal | **N/A** — 00 owns no money path. Enforced in schema for 06+ |
| Availability / no overbooking | **N/A** — 03. `btree_gist` installed ready for its constraint |
| GST correctness | **N/A** — 06 |
| Append-only audit | ✅ DB trigger, behaviourally proven |
| Append-only events | ✅ DELETE refused; UPDATE limited to `dispatchedAt`/`attempts` |

---

## 3. Security

- ✅ **Server-side authz on every mutation** — `authorize()` throws (never returns false), so a
  forgotten `if` cannot silently permit. Page reads guarded by `requirePermission()`.
- ✅ **Property-scoped** — enforced by a Prisma client extension, not convention. Tests issue
  queries with **no** `where` clause and confirm they are still confined.
- ✅ **Inputs zod-validated** at every action boundary.
- ✅ **Event + audit on mutations**; both take `tx` as their first argument, so "same
  transaction" is the only callable form.
- ✅ **PII** — AES-256-GCM at rest, keyed search hashes, masking helpers, logger key-pattern
  redaction, and a runtime assertion that claims carry none.
- ✅ **No enumeration** — one message for wrong-password / unknown-email / locked / inactive,
  plus bcrypt work spent on unknown emails to avoid a timing oracle.
- ✅ **Secrets** — `.env` git-ignored (verified); `/.backups` git-ignored (a full DB dump was
  briefly un-ignored and was caught before any commit).

---

## 4. NFRs

- ✅ Mobile-first: 44px touch targets, phone-first layout, bottom tab bar, e2e on Pixel 7.
- ✅ Accessibility: Radix primitives, semantic landmarks, `aria-current`, visible focus,
  `role="alert"` errors, pinch-zoom **not** disabled (WCAG 1.4.4).
- ⚠️ **Latency budgets NOT verified** — see Carried risk R-1.

---

## 5. Architecture

- ✅ Layering respected; UI never touches infrastructure directly.
- ✅ No cross-module deep imports (checked).
- ✅ All `features/*` files ≤ 300 lines after splitting `auth/actions.ts` (345 → 180 + 106 + 83).
- ✅ No dependency outside `tech-stack.md` (Radix = shadcn/ui; `@aws-sdk/client-s3` = approved
  object storage; the rest is tooling).
- ✅ Raw `prisma` import outside `lib/` = **0**, enforced by a custom ESLint rule.

---

## 6. Data

- ✅ Migration applied; `prisma migrate diff` reports **zero drift**.
- ✅ Indexes come from the canonical schema.
- ✅ Seed idempotent (proven by re-running: counts unchanged).
- ⚠️ **Migration reversibility** — see finding F-2.

---

## Findings

### F-1 · Non-blocking · `db.unscoped()` has five call sites
`src/lib/db/index.ts` (definition), `features/auth/internal.ts`, `features/platform/actions.ts`,
`app/api/health/route.ts`, `app/(auth)/reset-password/page.tsx`.
Each is justified in a comment and each is legitimate (pre-session auth, liveness probe,
org-level config). **Action:** keep the count visible in future reviews; a sixth without a
strong reason is a smell.

### F-2 · Non-blocking · No `down` migration
`definition-of-done.md` asks for "migration written + **reversible**". Prisma Migrate has no
native down-migrations; the practical rollback is restore-from-backup, which is now scripted
and drilled ([restore-drill.md](../runbooks/restore-drill.md)). **Action:** treat the drill as
the rollback path, or add an ADR if the client wants hand-written down scripts.

### F-3 · Non-blocking · Section routes are placeholders
Ten `(dashboard)` routes render a "delivered by module NN" placeholder. Each still enforces
its permission server-side, so this is not a security gap — but the nav promises screens that
do not exist yet. **Action:** each module replaces its own placeholder; no action for 00.

---

## Carried risks

### R-1 · Performance budgets are unmeasured
`non-functional-requirements.md` budgets mutations at **p95 < 800ms**. Observed sign-in here is
**7–13s warm, up to 33s cold** — but that is a developer laptop to `ap-south-1`, several DB
round trips per sign-in. It says nothing about the app deployed beside its database.
**This budget is NOT verified and must be measured in staging** before go-live. Do not read any
number in this session as evidence for or against it.

### R-2 · Domain coverage gate not enforced in CI
`testing-strategy.md` requires **≥90% domain coverage**. Thresholds are configured in
`vitest.config.ts` but `npm run test:coverage` is not yet a CI gate — there is no CI pipeline
in the repo. **Action:** wire it when the pipeline from `deployment-and-infra.md` § CI/CD is
built.

---

## Deferred to their owning modules (correctly out of 00's scope)

Per `requirements.md` § Out of scope: the RBAC/user-management **admin UI**, 2FA-enforcement
policy screens, the audit-trail browser and backup/restore ops UI all belong to
**16-access-control-security**. Full PWA offline + background sync is **17-mobile-experience**
(00 ships only the installable manifest scaffold). Real webhook handlers register against
`processInbox` as **06/12/13** land; the worker sweep is wired and idle until then.

---

## Addendum — findings surfaced while building 01 (2026-07-22)

Two defects in 00 that only appeared once a second module exercised it. Both are
fixed; recorded here because the review above would otherwise read as complete.

### F-4 · **Was blocking** · An enforced-2FA user with no enrolment could never sign in
`SecuritySettings.enforced2faRoles` contained `ADMINISTRATOR`, but the seeded
U-ADMIN had no TOTP secret. FR-5 correctly withholds the session until the
second factor is presented — so the administrator was handed a code prompt they
had no way to satisfy. Not a logic error in `verifySecondFactor`; a missing
*path*. FR-5's wording ("must complete enrolment **before** their session is
granted") implies a redirect INTO enrolment, and `requirements.md` assigns those
screens to **16-access-control-security**, which does not exist yet.

**Fixed** by enrolling the U-ADMIN fixture (`prisma/seed/00-platform.ts`), which
restores the demo. **Still owed by 16:** an enforced-but-unenrolled user must be
routed to enrolment rather than to a dead-end prompt. Until then, any *new*
Administrator created without enrolment is locked out.

### F-5 · **Was blocking** · Revoked session + live cookie = infinite redirect loop
Hitting `/properties` with a revoked DB session but an unexpired Auth.js cookie
produced `ERR_TOO_MANY_REDIRECTS`:

```
/properties → (layout: real session null)      → /sign-in
/sign-in    → (middleware: cookie present!)    → /dashboard
/dashboard  → (layout: real session null)      → /sign-in → …
```

The middleware was treating `req.auth` — which only proves a *cookie exists* —
as evidence of a live session, exactly the conflation `security.md` warns
against. **Fixed** by removing the convenience redirect from middleware and
moving it to the sign-in page, which resolves the real session server-side and
can tell the difference. Regression test added:
`tests/e2e/platform.spec.ts › revoked session (regression)`.

**Why the original review missed both:** every 00 test signed in cleanly and
stayed signed in. Neither the *enforced-but-unenrolled* state nor the
*revoked-but-cookied* state was reachable from inside 00's own journeys. They
appeared the moment a second module added a route and a differently-configured
user. Worth remembering for later reviews — a module's own tests systematically
under-explore its degraded states.
