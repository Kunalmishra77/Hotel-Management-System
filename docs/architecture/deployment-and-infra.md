# Deployment, Infrastructure & CI/CD

How the system is hosted, shipped, and operated. Constraint: **India data region** (DPDP), integration secrets injected at runtime, zero external accounts needed for non-prod.

## Topology
```
                ┌──────────── India region (ap-south-1) ────────────┐
  Users ──TLS──▶│  Next.js app (SSR/RSC + Server Actions + /api)     │
                │  Worker process (pg-boss: night audit, comms,      │
                │     reminders, OTA sync, backups, outbox/inbox)    │
                │  PostgreSQL 14+     Object storage (S3/MinIO)       │
                └────────────────────────────────────────────────────┘
                         │ (live only after client onboarding)
        Razorpay/Cashfree · WhatsApp BSP · SMS(DLT) · Email · OTA · Tally/Zoho · LLM
```
The web app and the worker are the **two runtime processes** (same codebase). Modular monolith — one deployable ([ADR-0001](adr/0001-modular-monolith.md)).

## Environments
| Env | DB | Storage | Providers | Notes |
|---|---|---|---|---|
| **dev** | local Postgres | MinIO/local | all mock/sandbox | `npm run dev` + `npm run worker` |
| **staging** | managed Postgres (India) | S3 (India) | sandbox creds | mirrors prod |
| **prod** | managed Postgres (India, HA) | S3 (India, versioned) | live creds added per-integration as client onboards | |

## Containerization
- **Dockerfile** (multi-stage: deps → build → runtime) for the app; the worker runs the same image with `CMD npm run worker`.
- **docker-compose** for local: app, worker, postgres, minio.
- Migrations run as a release step: `npx prisma migrate deploy` before the new app version serves traffic.

## CI/CD (pipeline stages)
1. **CI (on PR):** `npm ci` → `typecheck` → `lint` → `test` (unit+integration on a throwaway Postgres) → build. Husky runs the same locally pre-commit.
2. **E2E:** Playwright against a preview deploy (mobile viewport).
3. **CD (on merge to main):** build image → push → run `migrate deploy` → deploy app + worker → smoke test (`/api/health`).
4. Gates: no deploy if tests red or coverage below floor; DB migration must be reversible.

## Secrets & config
- All secrets via environment ([`.env.example`](../../.env.example)) injected by the platform's secret manager — never in the image or repo.
- Integration mode flags (`*_MODE`, `AI_PROVIDER`) select sandbox vs live → **going live is a config change** ([ADR-0003](adr/0003-provider-abstraction.md)).

## Scaling & availability
- App is stateless (sessions in DB/JWT) → scale horizontally behind a load balancer.
- Worker: single-instance-safe via pg-boss locks; can scale with job partitioning if needed.
- Realtime (SSE) uses Postgres LISTEN/NOTIFY; for multi-instance, fan-out via a shared channel.
- **Correctness over availability on the booking path** — short serializable transactions + the exclusion constraint.

## Backup & DR
- Daily encrypted DB + object-storage backup to a separate India-region target ([00 BackupRun], [security.md](../../.claude/rules/security.md)); retention policy defined; **periodic restore drill** documented.
- PITR on managed Postgres where available.

**Implemented (00 T-18/T-19):**
| Concern | Where |
|---|---|
| Scheduled job | `daily-backup` in [`scripts/worker.ts`](../../scripts/worker.ts) — 02:30 Asia/Kolkata, before the 03:00 night-audit window |
| Job logic | [`src/lib/backup/`](../../src/lib/backup/) — `pg_dump` over `DIRECT_URL`, AES-256-GCM client-side, retention, `BackupRun` per attempt |
| Targets | S3 (`ap-south-*` enforced in code) or the encrypted local fallback when credentials are absent (FR-25) |
| Manual run | `npm run backup:now` |
| Restore drill | `npm run restore:drill` + [runbook](../runbooks/restore-drill.md) |
| Alerting | [`src/lib/alerts/`](../../src/lib/alerts/) — success *and* failure both alert (FR-24) |

Backup artifacts are git-ignored (`/.backups`, `*.dump*`). A live target outside
`ap-south-*` is refused at resolve time — DPDP residency is enforced in code, not
by convention.

## Observability
See [observability.md](observability.md) — structured logs (request id), latency/error dashboards, alerts on job/webhook/backup failure, `/api/health`.
