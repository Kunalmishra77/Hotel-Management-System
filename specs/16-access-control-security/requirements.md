# 16 · Access Control & Security — Requirements

> Source: client doc §15 + §18. Read with `rules/security.md`, `rules/user-roles.md`, `docs/architecture/rbac-matrix.md`, `rules/compliance.md`, `prisma/schema.prisma`. Builds the **admin surfaces** over 00-platform's primitives. Depth bar: `specs/03-reservations/*`.

## Purpose & scope
The user-facing management of security: user & role administration, permission overrides, 2FA enforcement policy, the audit-trail browser, backup/restore operations, and session/lockout controls. 00 provides the primitives (auth, `authorize`, audit write, backup job); this module provides the **screens and policies** an Administrator uses.

**In scope:** user CRUD + role assignment (scoped to properties); permission-override management; 2FA enforcement per role; audit-trail search/browse; backup status + on-demand backup + restore runbook trigger; active-session view + force-logout; security settings (password policy, lockout thresholds).
**Out of scope:** the auth mechanism, session issuance, `db.scoped`, `writeAudit`, the backup job engine (all 00); per-module authorization checks (each module calls `authorize`).

## Dependencies
- **Tier 0:** 00-platform (all primitives), 01 (properties for scope).
- **Consumed by:** every module (they enforce the permissions this module administers).

## Data owned
None new (reads/writes `User`, `RoleAssignment`, `PermissionOverride`, `AuditLog`, `BackupRun` — models owned by 00). This module is a **surface**, not a data owner.

## Functional requirements (EARS)
- **FR-1 (ubiquitous):** Allow an Administrator to create/edit/deactivate `User`s and assign one or more `RoleAssignment`s, each scoped to specific properties (or org-wide for Admin) — per `user-roles.md`.
- **FR-2 (ubiquitous):** Present the effective permission set for a user/role from the default map (`rbac-matrix.md`) merged with `PermissionOverride`; allow granting/revoking specific `module:action` overrides (audited).
- **FR-3 (event):** When roles/overrides change, the change is audited and takes effect on the user's next request — enforced **server-side per request** by re-reading the live session (`Session.revokedAt` null + fresh claims), **not** by trusting a stateless JWT that may still carry stale permissions.
- **FR-4 (ubiquitous):** Allow enforcing 2FA per role (e.g. mandate for Admin/Accounts); a user in an enforced role must enrol TOTP before accessing protected areas.
- **FR-5 (ubiquitous):** Provide an **audit-trail browser** — search AuditLog by actor, entity, action, date range, property — read-only, with PII in before/after already redacted. Search stays within budget on the canonical `AuditLog` indexes `@@index([orgId, action])` and `@@index([propertyId])` (action + property filters) alongside `([orgId, entityType, entityId])`, `([userId])`, `([createdAt])`.
- **FR-6 (ubiquitous):** Show backup status (last run, success/failure), allow an on-demand backup, and expose the documented **restore** runbook/trigger — all Admin-only, audited.
- **FR-7 (ubiquitous):** Show active sessions and allow **force-logout** of a user; expose password-policy + lockout-threshold settings. Force-logout sets `Session.revokedAt`; because every request validates `Session.revokedAt` server-side (FR-3), the revocation takes effect on the very next request — a stateless-JWT-only check that ignored server state would let a revoked session keep working until token expiry, which is disallowed.
- **FR-8 (unwanted):** If a non-Administrator attempts any of these actions, deny server-side (403) — `user:manage`, `integration:manage`, `settings:manage` are Admin (🔒) per `rbac-matrix.md`.
- **FR-9 (ubiquitous):** Every action here is audited (these are all sensitive/🔒 operations) and property/org-scoped.
- **FR-10 (ubiquitous):** Enforce a **backup retention policy** (configurable retention window; older `BackupRun` artifacts pruned) and run a **periodic automated restore-test job** that restores the latest backup into a throwaway environment and asserts integrity — surfacing the last restore-test result/timestamp in the admin surface, Admin-only + audited (`security.md` §18: backups are only as good as a verified restore).

## Non-functional (cited)
Audit search stays within list budgets via the canonical `AuditLog` indexes `(orgId, entityType, entityId)`, `(orgId, action)`, `(propertyId)`, `(userId)`, `(createdAt)`; admin screens usable on desktop and tablet; all data India-region + encrypted. (`non-functional-requirements.md`, `security.md`, `compliance.md`)

## Business rules referenced
`security.md` (authn/z, audit, backup, encryption), `compliance.md` (PII, region), `rbac-matrix.md` (the permission grid + 🔒 audited actions), `business-rules.md` §20.
