# 00 · Platform — Design

## Schema slice (from canonical `prisma/schema.prisma`)
Owns `Organization`, `User`, `Session`, `SecuritySettings`, `RoleAssignment`, `PermissionOverride`, `PasswordResetToken`, `AuditLog`, `DomainEvent`, `IntegrationInbox`, `BackupRun`. Reads `Property` (01) for scope.

**Schema notes — all confirmed present in canonical schema** (this module's migration materializes the slice; nothing is new):
- `PasswordResetToken(id, userId, tokenHash, expiresAt, usedAt, createdAt)`.
- `BackupRun(id, startedAt, completedAt, status, target, sizeBytes, error)`.
- `User.failedLoginCount`, `User.lockedUntil` for lockout (FR-4).
- `AuditLog.reason` (nullable) for 🔒 actions (FR-14).
- `Session(tokenHash, activePropertyId, ip, device, expiresAt, revokedAt)` backs force-logout and the active-property switch.
- `SecuritySettings(passwordMinLength, lockoutThreshold, enforced2faRoles, sessionTtlMinutes, discountThresholdPaise)` — per-org config home cited by FR-1/4/5/7; `DomainEvent.seq` (monotonic) supplies per-aggregate ordering (FR-18).

## Core primitives (the substrate every module uses) — `src/lib`
- `lib/context` — the per-request context (**AsyncLocalStorage**) carrying `{orgId, userId, propertyScope, activePropertyId, requestId, ip, device}`; established at the edge (middleware/action wrapper) and read by `db`, `writeAudit`, and `emitEvent` so callers never thread these fields by hand.
- `lib/auth` — Auth.js v5 config, credentials provider, bcrypt verify (min length `SecuritySettings.passwordMinLength`), TOTP (`otplib`), backup-code hashing, lockout at `SecuritySettings.lockoutThreshold`, session TTL `SecuritySettings.sessionTtlMinutes`, 2FA enforcement for `SecuritySettings.enforced2faRoles`, and session-claim assembly (`{userId, orgId, roleAssignments, resolvedPermissions, propertyScope, activePropertyId}`).
- `lib/permissions` — `PERMISSION_MAP` (generated from `rbac-matrix.md`), `resolvePermissions(roleAssignments, overrides)`, `authorize(user, permission, propertyId)`.
- `lib/db` — Prisma client + **`db.scoped(user)`**: a client whose every query is filtered to the user's **full** `propertyScope` (the authorization boundary; raw unscoped access is a lint-flagged exception for reporting rollups only) + **`db.activeProperty(user)`**: returns the switched active property (`session.activePropertyId`) for single-property reads that follow the property switcher.
- `lib/audit` — `writeAudit(tx, {...})` (same-tx, PII-redacted, append-only); `userId`/`requestId`/`ip`/`device` auto-filled from the request context.
- `lib/events` — `emitEvent(tx, event)` (outbox insert in the mutation's tx; `orgId`/`propertyId`/`requestId` auto-filled from context, monotonic `DomainEvent.seq` assigned for per-aggregate order) + `dispatchOutbox()` (pg-boss producer) + consumer registration helper (idempotent on event id).
- `lib/integrations` — `receiveInbound(provider, externalId, payload)` (dedupe insert) + `processInbox()` worker + signature-verify helpers.

## The canonical write-path (every mutation in every module uses this)
```ts
export async function action(input) {
  const data = schema.parse(input);                 // 1 validate (zod)
  const user = await requireSession();
  authorize(user, "module:action", data.propertyId); // 2 authorize (throws FORBIDDEN)
  return db.$transaction(async (tx) => {
    const result = await /* domain + writes */;      // 3 transaction
    await emitEvent(tx, { type, aggregateId, payload });// 4 event (outbox, same tx)
    await writeAudit(tx, { action, before, after });  // 5 audit (same tx)
    return ok(result);
  });
}
```
This is enforced by `implement-module` and `review-module`. FR-15/17 require steps 4–5 inside the same tx.

## Application — server actions (`features/auth`, `features/platform`)
- `signIn`, `verifyTotp`, `enroll2fa`, `confirm2fa`, `requestPasswordReset`, `resetPassword`, `signOut`.
- `assignRole`, `setPermissionOverride` (Admin; audited) — claim refresh on next request (FR-12).
- `switchProperty(propertyId)` — validates scope, sets active property in session.
- Workers (`scripts/worker.ts`): `dispatchOutbox`, `processInbox`, `dailyBackup`.

## App shell (`src/app/(dashboard)/layout.tsx`, `features/platform/components`)
- Auth gate in `middleware.ts` + layout; permission-filtered nav; **property switcher** limited to scope; installable PWA scaffold hook (full offline in 17).

## UI — wireframes (mobile-first)
**Sign-in / 2FA:**
```
┌───────────────────────────┐   ┌───────────────────────────┐
│      Woodpecker PMS        │   │   Two-factor code         │
│  Email [______________]   │   │   [ _ _ _  _ _ _ ]        │
│  Pass  [______________]   │   │   Enter the 6-digit code  │
│         [   Sign in   ]   │   │   ‹ Use a backup code     │
│         Forgot password?  │   │            [  Verify  ]   │
└───────────────────────────┘   └───────────────────────────┘
```
**App shell (phone):** top bar = property switcher + user menu; bottom tab bar = permission-filtered (Dashboard, Bookings, Guests, more…).

## Events
Emits: `UserSignedIn`, `RoleAssigned`, (envelope/outbox for all modules). Owns the DomainEvent mechanism; domain events themselves live with their modules. Catalog: `docs/architecture/domain-events.md`.

## Sequences
**Sign-in (2FA):** credentials → verify hash → if 2FA: challenge → verify TOTP/backup → assemble claims → issue rotating session. **Outbox dispatch:** worker polls undispatched `DomainEvent` → publish to pg-boss → stamp `dispatchedAt`; consumer runs idempotently, failures retry→dead-letter.

## Error catalog
`INVALID_CREDENTIALS` (generic), `TOTP_REQUIRED`, `TOTP_INVALID`, `ACCOUNT_LOCKED`, `TOKEN_INVALID`, `FORBIDDEN`, `OUT_OF_SCOPE`.

## Edge cases
- Clock skew for TOTP → allow ±1 step window. Lockout uses injected clock (testable).
- Race on backup-code reuse → consume atomically (unique/row-lock).
- Outbox dispatcher crash mid-batch → resumes; at-least-once + idempotent consumers cover it.
- Property switch to a now-revoked property → re-validate scope on each request.
- Session claim staleness after permission change → refresh on next request (FR-12).
