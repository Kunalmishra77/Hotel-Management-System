# 00 · Platform — Tasks

Foundation. Build first; every other module depends on these primitives. Test-first for domain/security. Each ends at `rules/definition-of-done.md`. `(AC-n)/(FR-n)` = traceability.

## Schema & migration
- [x] T-1 Confirm owned models (all **present in canonical schema**): `Organization`, `User`, `Session`, `SecuritySettings`, `RoleAssignment`, `PermissionOverride`, `PasswordResetToken`, `AuditLog`, `DomainEvent`, `IntegrationInbox`, `BackupRun` (incl. `User.failedLoginCount/lockedUntil`, `AuditLog.reason`, `DomainEvent.seq`); materialize the migration slice. (FR-4/6/14/18/23)
- [x] T-2 Seed fixtures (ORG, PROP-A/B, U-ADMIN, U-REC-A, U-ACC).

## Auth & session
- [x] T-3 Auth.js credentials + bcrypt(≥12); session-claim assembly. (FR-1/2, AC-1)
- [x] T-4 TOTP enroll/confirm + backup codes (hashed, single-use); ±1 step window. (FR-3/5, AC-2/3/5)
- [x] T-5 Lockout/backoff + non-enumerating generic error (injected clock). (FR-4, AC-4)
- [x] T-6 Password reset: signed single-use expiring token, invalidates sessions. (FR-6, AC-6)
- [x] T-7 Assert no PII in session claims. (FR-7, AC-7)

## Tenancy & authorization
- [x] T-8 `db.scoped(user)` property filter; lint rule flagging raw unscoped queries. (FR-8, AC-8)
- [x] T-9 Out-of-scope request → FORBIDDEN pre-read. (FR-9, AC-9)
- [x] T-10 `PERMISSION_MAP` from rbac-matrix + `resolvePermissions` + `authorize`; deny-by-default. (FR-10/11, AC-10/11)
- [x] T-11 Role/override change → permission refresh next request. (FR-12, AC-12)
- [x] T-12 🔒 actions require permission + audited reason. (FR-14, AC-13)

## Audit, events, inbox
- [x] T-13 `writeAudit()` same-tx, PII-redacted; DB-guard append-only. (FR-15/16, AC-14/15)
- [x] T-14 `emitEvent()` outbox insert same-tx. (FR-17, AC-16)
- [x] T-15 `dispatchOutbox()` worker: at-least-once, `dispatchedAt`, per-aggregate order. (FR-18, AC-17)
- [x] T-16 Retry/backoff → dead-letter + admin alert; idempotent consumers on event id. (FR-19/20, AC-18/19)
- [x] T-17 `receiveInbound()` dedupe on `(provider,externalId)`; `processInbox()` exactly-once after signature verify. (FR-21/22, AC-20/21)

## Backup
- [x] T-18 Daily pg-boss backup (DB+storage) encrypted, India region, retention, `BackupRun` + alert; sandbox fallback with no creds. (FR-23/24/25, AC-22/23)
- [x] T-19 Document + script a restore drill. (NFR)

## App shell (mobile-first)
- [x] T-20 `middleware.ts` auth gate; `(dashboard)` layout; permission-filtered nav. (FR-26, AC-24)
- [x] T-21 Property switcher scoped to user; active property persists; PWA scaffold hook. (FR-27, AC-25)
- [x] T-22 Sign-in / 2FA / reset screens (mobile-first). (AC-1/2/6)

## E2E
- [x] T-23 Journeys: password sign-in; 2FA sign-in; forbidden cross-property; property switch. (AC-1/2/9/25)

## Done
- [x] T-24 `/review-module` clean; every AC → green test; DoD satisfied. This module gates all others — do not start Tier 1 until green.
