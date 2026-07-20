# API Conventions

The "API" is **Server Actions** (mutations, form flows) + **Route Handlers** under `src/app/api` (webhooks, exports, public booking-engine, SSE). No separate backend.

## Server Actions
- Signature: `async function verbNoun(input): Promise<Result<T>>`. Every action:
  1. `zod.parse` the input (reject invalid early),
  2. resolve session + **authorize** (permission, property scope),
  3. do work in a **transaction** where multiple writes must be atomic,
  4. **emit domain event** + **audit**,
  5. return a typed `Result` (`{ ok: true, data }` | `{ ok: false, error }`) — never throw raw to the client.
- Idempotency for anything externally triggered (payment/OTA webhooks) via idempotency keys.

## Route Handlers
- Used for: provider webhooks (`/api/webhooks/*` — verify signature first), file/exports (`/api/exports/*`), SSE realtime (`/api/realtime`), public booking engine (`/api/booking-engine/*`), AI streaming (`/api/ai/*`).
- Validate, authorize (or verify signature), rate-limit. Same event/audit rules apply.

## Responses & errors
- Consistent shape; user-safe messages; error codes from a shared enum. Log the internal detail server-side with a request id; return the id to the client for support.
- Pagination: cursor-based for large lists; never return unbounded result sets (`non-functional-requirements.md`).

## Realtime
- SSE channel per property; events filtered by the subscriber's permission/scope. Payloads carry only what the UI needs (no PII beyond need).

## Versioning & stability
- Public/external surfaces (booking-engine, webhooks) are versioned. Internal server actions evolve with their module spec.
