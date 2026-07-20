# 16 · Access Control & Security — Design

## Schema slice
No owned tables — operates on `User`, `RoleAssignment`, `PermissionOverride`, `AuditLog`, `BackupRun`, `SecuritySettings`, `Session` (all 00). **Confirmed present in canonical schema:** `SecuritySettings(orgId, passwordMinLength, lockoutThreshold, enforced2faRoles[], sessionTtlMinutes, discountThresholdPaise)` and `Session(id, userId, tokenHash, activePropertyId, revokedAt, expiresAt, …)` — 00 uses **DB-backed sessions**, so revocation/claim-refresh is checked server-side per request, not from stateless JWT. `AuditLog` carries `@@index([orgId, action])` + `@@index([propertyId])` (FR-5 filters). Nothing new; migration materializes the slice.

## Domain layer (pure) — `features/security/domain/`
- `effectivePermissions(role, overrides)` — merge default map + overrides (reuses 00 `lib/permissions`).
- `is2faRequired(role, settings)`.

## Application — server actions (`features/security/actions.ts`)
Per `api-conventions.md`; all `user:manage`/`settings:manage` (Admin, 🔒).
- `createUser/updateUser/deactivateUser`, `assignRole/revokeRole` — scoped; audited. (FR-1)
- `setPermissionOverride` — audited; claim refresh. (FR-2/3)
- `setEnforced2fa(roles)` / `updateSecuritySettings`. (FR-4/7)
- `searchAudit(filter)` — read-only; actor/action/entity/date/property filters hit the `AuditLog` indexes above. (FR-5)
- `backupStatus()` / `triggerBackup()` / `restoreRunbook()` (00 job). (FR-6)
- `backupRetentionPolicy()` / `runRestoreTest()` — retention window config + periodic automated restore-verification job; surfaces last restore-test result. (FR-10)
- `listSessions()` / `forceLogout(userId)` — sets `Session.revokedAt`; effective next request via the per-request server-side session check (not stateless JWT). (FR-7)

## UI — wireframes (desktop/tablet-first admin, `features/security/components/`)
```
┌───────────────────────────────┐
│ Users & Roles          [+ Add]│
│ ravi@… RECEPTION · PROP-A     │
│ anita@… ACCOUNTS · A,B · 2FA✓ │
│ ▸ Permissions (effective)     │
│ ▸ Overrides: folio:refund ✔   │
│ Audit trail ▸  Backups ▸      │
│ Sessions ▸  Security settings │
└───────────────────────────────┘
```
Audit browser = filterable table; backups = status + trigger + restore doc; sessions = force-logout.

## Events
Emits: `UserCreated`, `RoleAssigned`, `PermissionOverrideChanged`, `SecuritySettingsChanged`, `BackupTriggered`, `SessionForceLoggedOut` — all audited. Catalog: `docs/architecture/domain-events.md`.

## Error catalog
`FORBIDDEN`, `VALIDATION_FAILED`, `LAST_ADMIN_PROTECTED` (can't remove the last admin).

## Edge cases
- Removing the last Administrator → blocked (`LAST_ADMIN_PROTECTED`).
- Override that contradicts a 🔒 rule → still audited; matrix reason enforced.
- Force-logout self → allowed with confirm.
- Force-logout / permission change vs stale JWT → server re-validates `Session.revokedAt` + claims **every request**, so a revoked or re-permissioned session cannot ride an unexpired token.
- 2FA newly enforced for a role → existing users prompted to enrol on next login.
- Backup retention prune must never delete the most recent verified-restorable backup; restore-test runs against a throwaway target, never production.
