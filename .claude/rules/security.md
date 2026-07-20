# Security

## Authentication
- Auth.js v5, credentials provider, passwords hashed with bcrypt (cost ≥ 12).
- **2FA (TOTP)** available per user; enforceable per role (admin/accounts can be mandated). Backup codes issued.
- Sessions: short-lived, rotated; session carries userId, roles, and property scope claims.
- Lockout + backoff on repeated failed logins; password reset via signed, expiring token.

## Authorization (RBAC)
- **Server-side on every mutation and sensitive read.** Central guard: `lib/permissions`. UI hiding is cosmetic only.
- Permission = `module:action`; property-scoped. Deny by default. See `user-roles.md`, `docs/architecture/rbac-matrix.md`.
- Elevated actions (refund, void, PII export, discount over threshold, user management) require explicit permission + are audited.

## Audit trail (§18)
- Every create/update/delete of business data writes an immutable audit record: who, when, action, entity, before/after (redacted PII), request id, ip/device.
- Audit is append-only, retained, and queryable by admins. Never editable.

## Data protection
- **Encryption in transit** (TLS everywhere) and **at rest** (DB + object storage). PII fields additionally app-encrypted (`compliance.md`).
- Secrets only via env (`.env.example`); never in code, logs, or client bundles.
- Input validated with zod at every boundary; output PII redacted in logs; rate-limit auth + public/booking-engine + webhook endpoints.
- Webhooks (payments, messaging, OTA) verify provider signatures before processing.

## Backup & recovery (§18)
- **Daily automated backup** of DB + object storage to a separate location; encrypted; retention policy defined; periodic restore test.
- Backups run as a `pg-boss` scheduled job; success/failure alerts to admin.

## Secure-by-default checklist for every feature
- [ ] Authn required (unless explicitly public: login, booking-engine, webhooks)
- [ ] Authz permission checked server-side, property-scoped
- [ ] Inputs zod-validated; outputs PII-safe
- [ ] Mutation audited + event emitted
- [ ] No secret/PII in logs or responses beyond need
