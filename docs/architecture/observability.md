# Observability & Operations

How the running system is monitored, so failures are seen and diagnosed. Referenced by NFRs ([non-functional-requirements.md](../../.claude/rules/non-functional-requirements.md)) and security ([security.md](../../.claude/rules/security.md)).

## Logging
- **Structured JSON logs** with a `requestId` propagated through every action, query, job, and webhook.
- **Never log PII** (Aadhaar, contact, financial detail beyond need) — redact at the boundary; log the entity id + action, not the payload.
- Levels: error (needs attention), warn (degraded/retry), info (business events), debug (dev only).
- Correlate: `requestId` → action → domain event id → job → external call.

## Metrics (dashboards)
| Metric | Why |
|---|---|
| Action latency p50/p95 (per action) | NFR budgets (mutations < 800ms) |
| Search latency p95 | NFR (< 500ms) |
| Invoice/PDF render time | NFR (< 3s) |
| Realtime (SSE) event→screen latency | NFR (< 2s) |
| Job queue depth + processing time (pg-boss) | night audit / comms / OTA health |
| Event dispatch lag (commit→consume) | outbox health |
| Webhook success/signature-failure rate | integration health |
| Error rate by code | correctness |
| DB connections / slow queries | scale |

## Alerts (page an admin)
- **Backup failure** (daily job) · **night-audit failure** (per property) · **dead-lettered** message/OTA/accounting item · **webhook signature failures** spike · error-rate spike · queue backlog beyond threshold · DB saturation.
- Delivery: admin notification (in-app + email/WhatsApp via the same messaging layer).

## Health & readiness
- `/api/health` — liveness (process up) + readiness (DB reachable, worker heartbeat, storage reachable). Used by CD smoke test + load balancer.
- Worker heartbeat row updated each tick; alert if stale.

## Audit vs logs (distinct)
- **Audit** ([AuditLog], 00) = immutable business record of *who changed what* (compliance, §18). Never deleted.
- **Logs** = operational diagnostics, retained per policy, PII-redacted. Don't conflate.

## Runbooks (operational)
- Restore-from-backup drill · re-run a failed night audit (idempotent) · replay dead-lettered integration items · rotate a leaked secret · force-logout a user (16) · re-index search.

## SLO orientation (starting targets)
- Booking path correctness: 100% (no overbooking) — hard invariant, not a percentage.
- Availability of the front-desk app: high; integrations degrade gracefully and never block it.
- Budgets in NFRs are CI-checked where feasible; regressions block merge.
