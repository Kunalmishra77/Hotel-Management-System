# 00 · Platform — User Stories & Acceptance Criteria

Roles per `rules/user-roles.md`. ACs map to tests and reference `docs/architecture/rbac-matrix.md`.

## Test Fixtures
| Ref | Entity | Value |
|---|---|---|
| ORG | Organization | "Woodpecker Group" |
| PROP-A, PROP-B | Property | two properties in ORG |
| U-ADMIN | User | ADMINISTRATOR (org-wide scope) |
| U-REC-A | User | RECEPTION @ PROP-A, 2FA disabled |
| U-ACC | User | ACCOUNTS @ PROP-A+B, 2FA enabled (TOTP + backup codes) |
| CLOCK | Injected clock | fixed instant for TOTP/lockout/token tests |

## US-1 — Secure sign-in
*As any staff user, I want to sign in securely, so that only authorized people use the system.*
- **AC-1:** Given U-REC-A with a correct password, when signing in, then a session (TTL = `SecuritySettings.sessionTtlMinutes`) is issued with claims `{userId, orgId, roleAssignments, resolvedPermissions, propertyScope, activePropertyId}` and `lastLoginAt` is stamped; the password is only ever compared as a bcrypt hash. (FR-1/2)
- **AC-2:** Given U-ACC (2FA on), when the password is correct but no/!invalid TOTP is given, then **no session** is issued; with a valid current TOTP code, the session is issued. (FR-3)
- **AC-3:** Given U-ACC uses a backup code, when it is valid & unused, then sign-in succeeds and that code is consumed (reuse fails). (FR-3)
- **AC-4:** Given consecutive failed attempts reaching `SecuritySettings.lockoutThreshold` (default 5) for an identity, when the next attempt is made, then backoff/lockout applies; the error message is identical whether or not the email exists (no enumeration). (FR-4)
- **AC-5:** Given U-REC-A enrolls 2FA, when they scan the secret and confirm with a valid TOTP, then 2FA activates and backup codes are shown once (stored hashed). (FR-5)
- **AC-6:** Given a password-reset request, when the signed single-use token is redeemed before expiry, then the password is reset and existing sessions invalidated; an expired/used token is rejected. (FR-6)
- **AC-7:** Session claims never contain guest PII (no Aadhaar/contact). (FR-7)

## US-2 — Tenancy & scope
*As a Manager, I want users to only see their properties, so that data stays isolated.*
- **AC-8:** Given U-REC-A (PROP-A), when any query runs via `db.scoped(user)`, then only PROP-A rows are returned. (FR-8)
- **AC-9:** Given U-REC-A, when a request targets PROP-B, then `FORBIDDEN` before any read/write. (FR-9)
- **AC-10:** Given U-ADMIN, when querying, then all ORG properties are in scope. (FR-10)

## US-3 — Authorization
- **AC-11:** Given the default map + no override, when U-REC-A calls `expense:approve` (not granted to Reception), then `FORBIDDEN` (403) server-side regardless of UI. (FR-11/13)
- **AC-12:** Given U-ADMIN changes U-REC-A's role, when U-REC-A makes their next request, then the new permissions are in effect. (FR-12)
- **AC-13:** Given a 🔒 action (e.g. `folio:refund`), when performed, then an audit row with actor + reason (where required) is written. (FR-14)

## US-4 — Audit & events
- **AC-14:** Given any business mutation commits, then an immutable `AuditLog` row (actor, action, entity, PII-redacted before/after, requestId, ip, device) is written in the **same transaction**. (FR-15)
- **AC-15:** Given an attempt to UPDATE/DELETE an `AuditLog` row, then it fails (append-only). (FR-16)
- **AC-16:** Given a mutation commits, then a `DomainEvent` is persisted in the same transaction (outbox); killing the process before dispatch loses no event. (FR-17)
- **AC-17:** Given undispatched events, when the dispatcher runs, then each is published to pg-boss at least once, `dispatchedAt` stamped, per-aggregate order preserved. (FR-18)
- **AC-18:** Given a consumer fails repeatedly, then retry-with-backoff to a cap, then dead-letter + admin alert; the event row survives. (FR-19)
- **AC-19:** Given the same event delivered twice, when consumed, then no double effect (idempotent on event id). (FR-20)

## US-5 — Inbound integrations
- **AC-20:** Given a webhook with `(provider, externalId)` already seen, when it arrives again, then it's ignored (dedupe) and returns success without reprocessing. (FR-21)
- **AC-21:** Given an unprocessed inbox row, when the worker runs, then it processes exactly once after signature verification and stamps `processedAt`. (FR-22)

## US-6 — Backup
- **AC-22:** Given the daily job runs with live creds, then DB + object storage are backed up to a separate encrypted India-region target, retention enforced, `BackupRun` recorded, admin alerted on success/failure. (FR-23/24)
- **AC-23:** Given no live backup creds (dev/CI), then it degrades to the local/sandbox target and still completes + records the run. (FR-25)

## US-7 — App shell
- **AC-24:** Given an unauthenticated request to a `(dashboard)` route, then redirect to sign-in; nav renders only the caller's permitted items. (FR-26)
- **AC-25:** Given U-ACC (PROP-A+B), when they switch active property, then subsequent reads scope to it and the choice persists across navigation; a user with one property sees no switcher. (FR-27)
