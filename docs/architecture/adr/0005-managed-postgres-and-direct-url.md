# ADR-0005: Managed Postgres (Supabase, ap-south-1) + split pooled/direct connection URLs

- **Status:** Accepted
- **Date:** 2026-07-21

## Context
`deployment-and-infra.md` and `database-setup.md` call for PostgreSQL 14+ hosted in an
India region for DPDP residency, but leave the host unnamed ("managed Postgres"). For
implementation the client provisioned a **Supabase** project. Supabase fronts Postgres
with **Supavisor** (a PgBouncer-compatible pooler):

- **Transaction mode** (port `6543`) multiplexes connections — correct for a serverless
  Next.js runtime that opens many short-lived connections, but it cannot hold
  session-scoped state: prepared statements, advisory locks, `SET`-based session config.
- **Session mode / direct** (port `5432`) behaves like plain Postgres.

Prisma Migrate takes an **advisory lock** and issues DDL, so it must not run through a
transaction-mode pooler. `prisma migrate dev` against port 6543 fails or corrupts the
migration lock.

## Decision
Split the connection into two env vars and declare both in the datasource:

```prisma
datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL") // runtime  — pooled (6543) where a pooler exists
  directUrl = env("DIRECT_URL")   // DDL/lock — direct or session mode (5432)
}
```

On a plain single-node Postgres (local dev, CI) both variables hold the same string, so
the schema is portable and nothing branches on the host.

## Consequences
- (+) `prisma migrate` / `db seed` / introspection work against a pooled managed host.
- (+) Runtime keeps pooling, which is what a serverless/edge-adjacent Next.js deployment
  needs; connection exhaustion under staff concurrency is avoided.
- (+) Still satisfies `compliance.md` data residency — the project is provisioned in an
  India region and backups inherit it.
- (−) Two variables to keep in sync; a misconfigured `DIRECT_URL` fails loudly at migrate
  time rather than silently at runtime (acceptable — it fails early).
- (−) Transaction-mode pooling disables Prisma prepared statements; `pgbouncer=true` is
  appended to `DATABASE_URL` so Prisma adjusts accordingly.

## Alternatives
- **Single direct URL for everything** — simplest, but a serverless runtime exhausts
  Postgres connection slots under normal front-desk concurrency; rejected.
- **Single pooled URL for everything** — breaks `prisma migrate` (advisory lock) and the
  `SELECT … FOR UPDATE` session assumptions in the invoice-numbering and credit-limit
  transactions; rejected.
- **Self-hosted Postgres on an India-region VM** — more operational burden (backup,
  patching, HA) for no benefit at this scale; the client already chose managed. Revisit
  only if a load test shows the pooler is the bottleneck.
