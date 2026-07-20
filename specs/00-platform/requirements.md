# 00 · Platform — Requirements

> Foundation module. Everything else depends on it. Source: client doc §15 (access), §16 (mobile/PWA shell), §18 (audit, backup). Read with `.claude/rules/security.md`, `architecture.md`, `data-model.md`, `compliance.md`, `non-functional-requirements.md`, `docs/architecture/{high-level-architecture,domain-events,rbac-matrix}.md`, and `prisma/schema.prisma`.

## Purpose & scope
Provide the cross-cutting substrate every module builds on: authentication (Auth.js + TOTP 2FA), the multi-property tenancy model and property-scope resolution, the session-claim shape, the RBAC permission primitive, the **canonical mutation write-path** (validate → authorize → transaction → emit `DomainEvent` (outbox) → write `AuditLog`), the outbox dispatcher (pg-boss), the inbound `IntegrationInbox`, the daily backup job, and the authenticated app shell (layout, permission-filtered nav, property switcher).

**In scope:** credentials sign-in + lockout/backoff; TOTP enrolment/verification + backup codes; password reset; session claims (userId, orgId, role assignments, resolved permissions, property scope); `db.scoped(user)` helper; `lib/permissions` default map (from `rbac-matrix.md`) + `PermissionOverride`; `RoleAssignment` write primitive + claim refresh; `writeAudit()`; `emitEvent()` outbox insert + `dispatchOutbox()` worker; `IntegrationInbox` receive/dedupe primitive; scheduled encrypted daily backup + admin alert; app shell + property switcher + PWA scaffold hook.
**Out of scope:** the RBAC/user-management **admin UI**, 2FA-enforcement policy screens, audit-trail browser, and backup/restore ops UI — those are the surfaces of **16-access-control-security**, built on 00's primitives. Full PWA/offline/background-sync is **17-mobile-experience** (00 provides only the installable shell scaffold). Property/Floor/Room entities belong to **01/02**. Domain-specific events/consumers belong to their emitting/consuming modules; 00 owns only the envelope, outbox, and dispatch mechanism.

## Dependencies
- **Tier 0, depends on nothing** (it is the base of Tier 0). Peers **01-property-management** and **02-room-inventory** consume 00's primitives but 00 does not depend on them at runtime beyond referencing `Property` for scope.
- **Downstream consumers:** every module (all use `db.scoped`, `authorize`, `emitEvent`, `writeAudit`, the session, and the app shell).

## Data owned
`Organization`, `User`, `Session`, `SecuritySettings`, `RoleAssignment`, `PermissionOverride`, `PasswordResetToken`, `AuditLog`, `DomainEvent`, `IntegrationInbox`, `BackupRun` (all **confirmed present in canonical `prisma/schema.prisma`**). Reads `Property` (owned by 01) only to resolve property scope. `SecuritySettings` (per-org) is the config home for `lockoutThreshold`, `sessionTtlMinutes`, `passwordMinLength`, `enforced2faRoles`, and `discountThresholdPaise` — cited by the FRs below instead of hardcoded constants.

## Functional requirements (EARS)

### Authentication & session
- **FR-1 (ubiquitous):** Every user authenticates via Auth.js v5 credentials; passwords are stored only as bcrypt hashes (cost ≥ 12) and must meet the minimum length in `SecuritySettings.passwordMinLength`; plaintext is never stored, logged, or returned.
- **FR-2 (event):** When a user submits valid credentials and 2FA is **not** enabled, establish a rotating session whose TTL is `SecuritySettings.sessionTtlMinutes`, carrying claims `{ userId, orgId, roleAssignments, resolvedPermissions, propertyScope, activePropertyId }`, and stamp `lastLoginAt`.
- **FR-3 (event):** When a user with 2FA enabled (individually, or by membership of a role in `SecuritySettings.enforced2faRoles`) submits valid credentials, withhold the session until a valid current TOTP code **or** an unused backup code is presented; a used backup code is consumed (single-use).
- **FR-4 (unwanted):** If an identity accrues consecutive failed credential attempts reaching `SecuritySettings.lockoutThreshold` (default 5), apply exponential backoff / lockout, record the attempts, and return an identical generic error whether or not the email exists (no account enumeration).
- **FR-5 (event):** When a user enables 2FA, generate a TOTP secret (encrypted at rest) and a set of one-time backup codes (stored hashed), and require a confirming TOTP code before activation. Roles listed in `SecuritySettings.enforced2faRoles` must complete enrolment before their session is granted.
- **FR-6 (event):** When a user requests a password reset, issue a signed, single-use, expiring token; on redemption with a valid token set a new bcrypt hash and invalidate the token and existing sessions.
- **FR-7 (state):** While a session is active it lives no longer than `SecuritySettings.sessionTtlMinutes` and is rotated, and it carries only the non-PII claims needed for authorization — never Aadhaar, contact, or other guest PII.

### Tenancy & property scope
- **FR-8 (ubiquitous):** Every operational read and write executes through the property-scoped helper `db.scoped(user)`, which filters to the user's **full** `propertyScope` (the authorization boundary); a single-property read that must honour the currently switched property instead reads `db.activeProperty(user)` (the session's `activePropertyId`). A user may access only rows whose `propertyId` is within their resolved property scope.
- **FR-9 (unwanted):** If a request targets a property outside the caller's scope, reject with `FORBIDDEN` before any data is read or written.
- **FR-10 (ubiquitous):** An Administrator's scope is org-wide (`RoleAssignment.propertyIds = []`/null ⇒ all properties in the org); every other role is scoped to its assigned `propertyIds`.

### Authorization (RBAC primitive)
- **FR-11 (ubiquitous):** Permissions are `module:action`, resolved from the code-defined default role→permission map (source: `docs/architecture/rbac-matrix.md`) merged with any `PermissionOverride`; access is **deny-by-default**.
- **FR-12 (event):** When a user's role assignments or overrides change, their effective permissions refresh no later than the user's next request.
- **FR-13 (unwanted):** If a mutation's required permission is absent for the caller, reject server-side with `FORBIDDEN` (HTTP 403) regardless of what the UI showed.
- **FR-14 (state):** While performing a permission marked 🔒 in `rbac-matrix.md`, require the explicit permission and write an audit record, including a `reason` where the matrix mandates one.

### Audit
- **FR-15 (event):** When any business mutation commits, write an immutable `AuditLog` row (`userId`, `createdAt`, `action`, `entityType`, `entityId`, PII-redacted `before`/`after`, `requestId`, `ip`, `device`) in the **same transaction** as the state change. The actor fields (`orgId`, `userId`, `requestId`, `ip`, `device`) are supplied by the per-request context (AsyncLocalStorage) rather than passed by each caller, so `writeAudit()`/`emitEvent()` fill them automatically.
- **FR-16 (unwanted):** If code attempts to update or delete an `AuditLog` row, it must fail — audit is append-only; `before`/`after` are PII-redacted before persistence.

### Domain events & outbox
- **FR-17 (event):** When a mutation commits, persist a `DomainEvent` (outbox) in the same transaction as the state change, so an event is never lost if dispatch later fails.
- **FR-18 (event):** A dispatcher publishes undispatched `DomainEvent`s to pg-boss **at least once**, stamps `dispatchedAt`, and preserves per-`aggregateId` ordering — the monotonic `DomainEvent.seq` provides the deterministic per-aggregate order even for multiple events committed in one transaction (cross-aggregate ordering is not assumed).
- **FR-19 (unwanted):** If a consumer repeatedly fails, retry with backoff up to a cap, then dead-letter the delivery with an admin alert — the event row is never discarded.
- **FR-20 (ubiquitous):** Consumers are idempotent and deduplicate on `DomainEvent.id`; re-delivery causes no double effect.

### Inbound integration inbox
- **FR-21 (event):** When an inbound provider event arrives (payment/OTA/messaging webhook), persist it to `IntegrationInbox` keyed by unique `(provider, externalId)`; a duplicate key is ignored (dedupe), returning success without reprocessing.
- **FR-22 (state):** While an `IntegrationInbox` row is unprocessed, a worker processes it exactly once and stamps `processedAt`; signature verification happens before the row is trusted.

### Backup & recovery
- **FR-23 (event):** A scheduled daily pg-boss job backs up the database + object storage to a separate, encrypted, India-region (`DATA_REGION`) location and enforces the retention policy.
- **FR-24 (event):** When a backup run completes or fails, record the run status and alert an administrator (success and failure both reported).
- **FR-25 (unwanted):** If live backup-storage credentials are absent, degrade to the sandbox/local target and still complete + record the run — dev/CI must run end-to-end with zero external accounts.

### App shell
- **FR-26 (ubiquitous):** The app shell gates every `(dashboard)` route behind authentication, renders navigation filtered to the caller's permissions, and provides a property switcher limited to the caller's property scope.
- **FR-27 (state):** While a user has more than one property in scope, allow switching the active property; the choice is stored as the session's `activePropertyId`, exposed via `db.activeProperty(user)`, scopes subsequent single-property reads, and is preserved across navigation (`db.scoped` still enforces the full-scope authorization boundary).

### Cross-cutting
- **FR-28 (ubiquitous):** Every 00-owned mutation is itself property-/org-scoped, authorized server-side, audited, and (where a state change of interest occurs) event-emitting — 00 both realizes and obeys `business-rules.md` §20.

## Non-functional (cited)
- Sign-in + session resolution p95 < 800ms; per-request authorization/scope resolution overhead < 50ms (`non-functional-requirements.md` → mutations feel instant).
- Event dispatch latency (commit → consumer picks up) target < 2s; live occupancy/dashboard update latency < 2s (`non-functional-requirements.md`).
- Daily backup success ≥ 99%; documented, drilled restore (`security.md`, `non-functional-requirements.md`).
- Structured logs with `requestId`; PII never in logs; alerts on job failure, webhook signature failure, backup failure (`non-functional-requirements.md` → observability).
- India data region for DB/backups/object storage (`compliance.md`).

## Business rules referenced
`business-rules.md` §20 (validate → authorize → transaction → event → audit — the canonical write path this module implements), §21 (shown values match DB). `security.md` (authn/z, audit, encryption, backup). `compliance.md` (PII masking/encryption, DPDP data residency, Aadhaar defaults). `user-roles.md` + `rbac-matrix.md` (role→permission map, property scope, 🔒 audited actions).
