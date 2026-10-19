# ADR-0005: Managed Postgres (Supabase, ap-south-1) + split pooled/direct connection URLs

- **Status:** Accepted — **amended 2026-10-19** (see *Revision 1*: the split stands; moving
  the runtime URL to session mode is measured and recommended, but BLOCKED on raising the
  pooler's `pool_size` first, so it is not yet applied)
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

## Revision 1 — 2026-10-18: `DATABASE_URL` moves to session mode (port 5432)

This ADR closed with "revisit only if a load test shows the pooler is the bottleneck."
A measurement now shows exactly that, and the premise it rested on turned out not to
describe the deployment.

**The premise was wrong.** The decision above reasons about "a serverless Next.js
runtime that opens many short-lived connections." The app is not serverless: it is
deployed on Coolify as `next start` — one long-lived Node process with a bounded Prisma
pool (`connection_limit=10`). Transaction-mode multiplexing solves a problem this
deployment does not have, and charges for it.

**What it charges.** Transaction mode cannot hold session state, so `pgbouncer=true`
makes Prisma wrap EVERY query in its own transaction and clear prepared statements
first. One logical read becomes four network round trips:

```
BEGIN  ·  DEALLOCATE ALL  ·  SELECT …  ·  COMMIT
```

Measured, same five sequential reads through each URL:

| Runtime URL | SQL statements | Wall clock |
|---|---|---|
| `:6543?pgbouncer=true` (transaction) | **20** — 4.0× | 1915ms |
| `:5432` (session) | **5** — 1.0× | 820ms |

On one real `/dashboard` render the wrapper accounted for **54 of 74 round trips** — 73%
of the page's database traffic was transaction ceremony rather than data. That is the
dominant cost because the app server and the database are in different regions
(Coolify/Lithuania ↔ Supabase/`ap-south-1`): each round trip is ~130ms of wire time for
a query that executes in ~0.1ms. Latency here is round-trip COUNT, not query cost.

**Decision.** Move `DATABASE_URL` to the session-mode pooler (`:5432`, no
`pgbouncer=true`) — **after** raising the pooler's `pool_size`, which is the blocker
described below. `DIRECT_URL` is unchanged and still exists for Migrate's advisory
lock — the two-variable split from the original decision stays exactly as it is.

**Not yet applied, and why.** Flipping the URL was attempted and reverted. At the
project's current `pool_size` of 15 the e2e suite produced **239 × EMAXCONNSESSION**
with the app serving 503s: CI opens many more Prisma clients than 15 (two browser
projects plus a client per spec file for fixture cleanup), and session mode has no
queue to absorb that. So the repo stays on transaction mode and pays the 4× tax until
step 1 below is done. The sequence is not optional:

1. Supabase → Database → Connection pooling → **Pool Size: 15 → 25**.
   Headroom measured on this project: `max_connections` 60, 3 superuser-reserved,
   ~13 held by Supabase's own services → ~44 available, so 25 is comfortable.
2. Then set `DATABASE_URL` to `:5432` without `pgbouncer=true`, and divide the budget
   as `.env.example` specifies.

Doing step 2 first does not degrade gracefully — it takes the app down.

**Why this is safe here.** Session mode holds one server connection per pooled client
connection, which is affordable precisely because the process is long-lived and its pool
is bounded: the web app caps at `connection_limit`, and the pg-boss worker already
required a session connection (see `Dockerfile.worker`). It also restores what the
original ADR listed as a hazard of pooling — prepared statements, advisory locks, and the
`SELECT … FOR UPDATE` session assumptions in invoice numbering and credit limits now run
on a connection that can actually hold session state.

**The cost this moves, not removes — the connection budget.** Session mode caps TOTAL
concurrent clients at the pooler's `pool_size`. That cap does not queue; it fails hard,
and the app answers 503 rather than answering slowly. The limits are therefore part of
this decision, not an operational detail — and the library defaults overdraw the budget
on their own: Prisma defaults to `num_cpus*2+1` and pg-boss to 10, already past 15 before
the web app asks for anything. Each consumer claims its share explicitly; `.env.example`
carries the arithmetic and is the place to keep it current.

**One fix lands regardless of which mode wins.** This cap was already being consumed
before this revision: the worker's pg-boss has always used `DIRECT_URL` — session mode —
at its default pool of 10, two thirds of the budget, unclaimed and undocumented. That is a
latent fragility independent of the web app's URL, so `PGBOSS_POOL_SIZE` (default 4) is
applied now rather than held behind the pooler change.

**Trade-off accepted.** Fewer connections, each ~4x more productive. The web app's 5
session-mode connections sustain more work than the previous 10 transaction-mode ones,
because a connection that spends one round trip per query instead of four is released
four times sooner.

**When to revisit.** If this app is ever deployed to a serverless or per-request-isolate
runtime, or scaled to many instances whose combined `connection_limit` approaches the
project's connection budget, transaction mode becomes correct again — and the 4× round-trip
tax becomes the right price for not exhausting connections.

## Alternatives
- **Single direct URL for everything** — simplest, but a serverless runtime exhausts
  Postgres connection slots under normal front-desk concurrency; rejected.
- **Single pooled URL for everything** — breaks `prisma migrate` (advisory lock) and the
  `SELECT … FOR UPDATE` session assumptions in the invoice-numbering and credit-limit
  transactions; rejected.
- **Self-hosted Postgres on an India-region VM** — more operational burden (backup,
  patching, HA) for no benefit at this scale; the client already chose managed. Revisit
  only if a load test shows the pooler is the bottleneck.
