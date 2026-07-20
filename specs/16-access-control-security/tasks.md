# 16 · Access Control & Security — Tasks

Surface over 00's primitives. All actions Admin + 🔒 audited. Each ends at `rules/definition-of-done.md`. `(AC-n)/(FR-n)`.

## Schema & migration
- [ ] T-1 `SecuritySettings` and `Session` (DB-backed sessions, `revokedAt`) are **confirmed present in canonical schema**; migration materializes the slice; `AuditLog` `(orgId, action)` + `(propertyId)` indexes confirmed on 00's model.
- [ ] T-2 Seed fixtures (U-ADMIN, roles, audit rows, a BackupRun).

## Domain (tests first)
- [ ] T-3 `effectivePermissions` merge (reuse 00 map). (FR-2, AC-3)
- [ ] T-4 `is2faRequired`. (FR-4, AC-5)

## Application (integration tests)
- [ ] T-5 `createUser`/`assignRole` scoped + audit; scope enforced via 00. (FR-1/3, AC-1/2)
- [ ] T-6 `setPermissionOverride` + claim refresh + audit. (FR-2/3, AC-3)
- [ ] T-7 `setEnforced2fa` gates protected areas until enrol. (FR-4, AC-5)
- [ ] T-8 `searchAudit` filters (actor/action/entity/date/property) on `(orgId, action)`/`(propertyId)` indexes. (FR-5, AC-6)
- [ ] T-9 `backupStatus/triggerBackup/restoreRunbook` (00 job) audited. (FR-6, AC-7)
- [ ] T-9b `backupRetentionPolicy` prune + periodic `runRestoreTest` job (throwaway restore + integrity assert + surfaced result), Admin-only + audited. (FR-10, AC-9)
- [ ] T-10 `listSessions/forceLogout` sets `Session.revokedAt`; per-request server-side session check rejects revoked/stale-claim sessions (not stateless JWT) + settings update. (FR-7/3, AC-8)
- [ ] T-11 RBAC: non-admin denied all. (FR-8, AC-4)
- [ ] T-12 Last-admin protection. (edge)
- [ ] T-13 Every action audited. (FR-9, AC-10)

## UI (admin, tablet/desktop-first)
- [ ] T-14 Users & roles + effective permissions + overrides. (AC-1/3)
- [ ] T-15 Audit browser + backups (status + retention + last restore-test) + sessions + settings. (AC-6/7/8/9)

## E2E
- [ ] T-16 Journey: create scoped user → grant override → user gains access next request → audit shows it. (AC-1/2/3/6)

## Done
- [ ] T-17 `/review-module` clean; every AC → green test; DoD satisfied.
