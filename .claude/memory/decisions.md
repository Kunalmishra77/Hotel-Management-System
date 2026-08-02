# Decision Log (lightweight)

Running log of settled decisions. Big architectural ones get a full ADR in `docs/architecture/adr/`; this is the quick index + smaller calls.

| Date | Decision | Where |
|---|---|---|
| 2026-07-18 | Full §1–19 scope built now; nothing deferred | rules/scope.md |
| 2026-07-18 | Stack: Next.js + React + TS + Postgres/Prisma + Auth.js | rules/tech-stack.md |
| 2026-07-18 | AI is provider-agnostic (`LLMProvider`), default mock | rules/ai-features.md, ADR-0003 |
| 2026-07-18 | PII: mask Aadhaar by default; full behind compliance flag; client to confirm | rules/compliance.md |
| 2026-07-18 | Modular monolith on Next.js | ADR-0001 |
| 2026-07-18 | Money = integer paise; time = UTC + property-local dates | ADR-0002 |
| 2026-07-18 | Provider abstraction, sandbox-by-default | ADR-0003 |
| 2026-07-18 | Mobile-first PWA, no native apps | ADR-0004 |
| 2026-07-18 | 26 module split (§19 expanded into full modules) | rules/scope.md |
| 2026-07-20 | GST place-of-supply = property state for on-premise supplies (always CGST+SGST) | rules/business-rules.md §10 |
| 2026-07-20 | Money: BigInt for accumulating totals, Int for bounded values | rules/data-model.md, business-rules §8 |
| 2026-07-20 | DB-backed sessions + per-request `revokedAt` check (force-logout); `activePropertyId` in claims | rules/security.md, spec 00/16 |
| 2026-07-20 | Independent 5-reviewer audit → 92 findings fixed; schema finalized to 66 models + `prisma validate` PASS | docs/handover-review-findings.md |
| 2026-07-20 | Manual folder audit (Pass 3): §11 coupons built as a redeemable feature; per-property comms content; **new module 26 data-onboarding** (go-live import). Schema → **70 models / 27 modules** | docs/requirements-traceability.md, specs/26-data-onboarding |

## Open questions (need client/stakeholder input before their module is built)
- Aadhaar full-storage flag: on or off for go-live? (compliance)
- Which WhatsApp BSP, SMS provider, payment gateway will the client onboard? (integrations — affects only live activation, not the build)
- Channel manager: direct OTA certification vs aggregator? (13-booking-channel-integrations)
- Accounting target: Tally, Zoho Books, or both? (22-accounting-sync)

---

## Implementation decisions — 00-platform (2026-07-21)

Recorded so later modules inherit the reasoning instead of re-litigating it.

| Decision | Why | Where |
|---|---|---|
| **One baseline migration** for all 70 models; per-module **DB constraints** thereafter | The canonical schema is finalized with every delta folded in, and `prisma migrate diff` operates on the whole datamodel — a partial migration reports the other 59 models as drift on the next command. The part that carries real risk (constraints) still lands in tier order. | `prisma/migrations/20260721120000_platform_init/` |
| **Append-only via trigger, not `REVOKE`** | Prisma connects as the table owner, and an owner cannot be stripped of privileges on its own table — a `REVOKE` would look present while enforcing nothing. | same migration |
| **`DomainEvent` is NOT blanket append-only** | FR-18 requires the dispatcher to stamp `dispatchedAt`/`attempts`. DELETE is refused outright; UPDATE is limited to those two columns. A blanket guard would deadlock the outbox on its first dispatch. | same migration |
| **Sessions = opaque token + DB lookup, not JWT claims** | `security.md` requires `revokedAt` re-checked every request. Rebuilding claims per request makes FR-12 literally true and force-logout instant. | `lib/auth/session.ts` |
| **`db.scoped` is a Prisma client extension** | A convention is only as strong as the sloppiest `where` clause anyone ever writes. The filter is injected by the client, so a query that forgets to scope is still scoped. | `lib/db/index.ts` |
| **`writeAudit(tx, …)` / `emitEvent(tx, …)` take the transaction first** | Makes "same transaction" the only callable form. A version reaching for a global client would let state commit while the audit write failed. | `lib/audit`, `lib/events` |
| **Split pooled / direct DB URLs** | Prisma Migrate takes an advisory lock a transaction-mode pooler cannot hold. | ADR-0005 |
| **Explicit interactive-transaction ceilings (10s wait / 15s timeout)** | Prisma's 5s default aborts the canonical write path over a real network. These are ceilings, not targets — the p95 budget is still 800ms. | `lib/db/client.ts` |
| **`experimental.authInterrupts` enabled** | Without it `forbidden()` degrades to 404, silently violating FR-13's "FORBIDDEN (HTTP 403)". | `next.config.ts` |
| **Backup codes hashed with SHA-256, not bcrypt** | 10 CSPRNG chars from a 30-symbol alphabet (~49 bits) that we generate — no dictionary to attack, so a slow KDF buys nothing and taxes every 2FA verification. | `lib/auth/totp.ts` |
| **`INVALID` credentials carry `userId` only when the email matched** | FR-4 needs both halves: identical client-facing errors AND failed attempts accruing against a real account. The id is internal and never surfaced. | `lib/auth/credentials.ts` |
| **Seeded fixtures are read-only in tests** | A test that mutated a shared fixture and failed before restoring left the DB dirty and re-broke itself on every later run. Mutating tests now create throwaway users. | `tests/helpers/temp-user.ts` |
| **Reason-required 🔒 permissions derived from downstream specs** | `rbac-matrix.md` marks 🔒 without saying which mandate a reason; the set of 9 is taken from specs that pass an explicit `reason` argument (e.g. `06.refund`, `04.revealPii`). Each is cited in code. **Worth client confirmation.** | `lib/permissions/permission-map.ts` |

## Implementation decisions — 01-property-management (2026-07-22)

| Decision | Why | Where |
|---|---|---|
| **Creating a property requires org-wide scope** | Reconciles rbac-matrix.md (Manager holds `property:manage` 🔒) with AC-9 (Manager denied creation): a property that does not exist yet is inside nobody's assignment. Expressed as a scope check, not a role-name check, per user-roles.md. | `features/properties/internal.ts` |
| **GSTIN validated including the check digit** | design.md asks for it, and a GSTIN lands on a statutory invoice. Two spec fixtures failed their own checksum and were corrected; the old value is now the wrong-checksum negative case. | `features/properties/domain/gstin.ts` |
| **Live occupancy is basis points, RESERVED excluded, maintenance out of the denominator** | reporting.md defines two occupancy figures and forbids conflating them; the tile is the point-in-time one and is labelled as such. Integer bps, never a float. | `features/properties/domain/occupancy.ts` |
| **Realtime = ONE process-wide poller, not one per connection** | Per-connection polling exhausted the connection pool and broke sign-in under load — cost must be O(1) in viewers, not O(N). | `lib/events/broker.ts` |
| **The realtime channel is platform infrastructure** | 01 (Tier 1) cannot depend on 17 (Tier 5); tech-stack.md lists realtime under Platform services and api-surface.md defines `/api/realtime` in the core API. 17 swaps in LISTEN/NOTIFY without changing the consumer surface. | `app/api/realtime/route.ts` |
| **Queries take claims explicitly, never resolve a session** | Layering (architecture.md), and it keeps the query layer testable without the Auth.js import chain. | `features/properties/queries.ts` |
| **Required-field asterisk lives OUTSIDE `<Label>`** | Inside, it becomes label text: the accessible name turns into "Code*" and a screen reader says "Code asterisk". `aria-hidden` on a child span does not help. | `features/properties/components/property-form.tsx` |
