import { config } from "dotenv";

// Precedence: .env.test (CI throwaway DB) → .env.local → .env. dotenv does not
// overwrite an already-set key, so the first file to define one wins.
// Nothing here reaches a live provider: every adapter degrades to sandbox/mock
// when credentials are absent (rules/integrations.md).
config({ path: ".env.test", quiet: true });
config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

/**
 * Tests talk to the database over DIRECT_URL, not the pooled DATABASE_URL.
 *
 * The integration suite leans on Prisma INTERACTIVE transactions
 * (`$transaction(async tx => …)`), which need a session-pinned connection to
 * hold BEGIN…COMMIT across statements. A PgBouncer/Supavisor transaction-mode
 * pooler cannot promise that, and `?connection_limit=1` compounds it: with one
 * PrismaClient per test file, a full run starves and tests time out — while the
 * same file passes in isolation. That flakiness is a configuration artefact,
 * not a product bug, so tests use the session-mode endpoint.
 *
 * Production keeps the pooled URL — see ADR-0005.
 */
if (process.env.DIRECT_URL) {
  process.env.DATABASE_URL = process.env.DIRECT_URL;
}

// Deterministic PII key for tests so encrypted columns round-trip stably.
process.env.PII_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");
process.env.AUTH_SECRET ??= "test-auth-secret-not-used-in-production";
