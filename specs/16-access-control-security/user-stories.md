# 16 · Access Control & Security — User Stories & Acceptance Criteria

Roles per `rules/user-roles.md`; grid per `docs/architecture/rbac-matrix.md`. All actions here are Admin + 🔒 audited.

## Test Fixtures
| Ref | Entity | Value |
|---|---|---|
| ORG | Organization | Woodpecker Group (PROP-A, PROP-B) |
| U-ADMIN | User | ADMINISTRATOR |
| U-NEW | User | to be created: RECEPTION @ PROP-A |
| U-ACC | User | ACCOUNTS (2FA enforced) |
| U-MGR | User | MANAGER (not Admin) |

## US-1 — User & role administration
- **AC-1:** Given U-ADMIN, when creating U-NEW with role RECEPTION scoped to PROP-A, then the user + `RoleAssignment(propertyIds=[PROP-A])` persist; audited. (FR-1)
- **AC-2:** Given U-NEW, when they sign in, then their scope is PROP-A only (enforced by 00 `db.scoped`); PROP-B is forbidden. (FR-1/3)
- **AC-3:** Given U-ADMIN grants a `folio:refund` override to RECEPTION, when saved, then the effective permission set reflects it and the change is audited; it takes effect on the user's next request via the **server-side per-request session/claim check** (not a stale JWT). (FR-2/3)
- **AC-4:** Given U-MGR (not Admin), when accessing user management, then `FORBIDDEN` (403). (FR-8)

## US-2 — 2FA enforcement
- **AC-5:** Given 2FA is enforced for ACCOUNTS, when U-ACC (not yet enrolled) tries to access a protected area, then they must enrol TOTP first. (FR-4)

## US-3 — Audit browser
- **AC-6:** Given audit entries exist, when U-ADMIN searches by actor + action + property + date range + entity, then matching immutable AuditLog rows return within budget on the `(orgId, action)` / `(propertyId)` / `(orgId, entityType, entityId)` indexes (before/after PII already redacted). (FR-5)

## US-4 — Backup & sessions
- **AC-7:** Given backups run daily, when U-ADMIN opens security settings, then last-run status is shown; an on-demand backup can be triggered; the restore runbook is exposed — all audited. (FR-6)
- **AC-8:** Given active sessions, when U-ADMIN force-logs-out a user, then `Session.revokedAt` is set and that user's next request is rejected by the **server-side session check** (re-auth) — a still-unexpired JWT does not keep them in; password-policy + lockout thresholds are editable. (FR-7)
- **AC-9:** Given the retention policy window, when it elapses, then `BackupRun` artifacts older than the window are pruned (never the latest verified-restorable one); and the **periodic restore-test job** restores the latest backup to a throwaway target, asserts integrity, and surfaces the last restore-test result/timestamp — Admin-only + audited. (FR-10)

## Security
- **AC-10:** Every action in this module writes an audit record (all are 🔒). (FR-9)
