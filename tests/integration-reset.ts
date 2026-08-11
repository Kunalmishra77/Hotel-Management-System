/**
 * Per-file DB reset for the DEDICATED integration test database — the real fix for
 * cross-file contamination (files deriving overlapping wall-clock month/date
 * windows). Before each integration file's tests, TRUNCATE every table and reseed
 * the minimal fixture, so each file starts from an identical clean state and no
 * other file's rows can leak in.
 *
 * SAFETY: triple-gated so it can NEVER run against the shared/remote DB —
 * requires RESET_DB_PER_FILE=true AND a localhost host AND the `woodpecker_test`
 * database name. Anything else (Supabase, any remote) is a no-op.
 *
 * Only loaded by `vitest.integration.config.ts` (not the default unit config), so
 * the fast unit gate never pays for a reseed.
 */
import { config } from "dotenv";
config({ path: ".env.test", quiet: true });

import { beforeAll } from "vitest";
import { createPrismaClient } from "@/lib/db/client";
import { seedDatabase } from "../prisma/seed";

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "";
const isLocalTestDb =
  /(?:@|\/\/)(?:127\.0\.0\.1|localhost)(?::\d+)?\//.test(url) && /\/woodpecker_test(\?|$)/.test(url);

const TRUNCATE_ALL = `DO $$ DECLARE r RECORD; BEGIN
  FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations') LOOP
    EXECUTE 'TRUNCATE TABLE public.' || quote_ident(r.tablename) || ' RESTART IDENTITY CASCADE';
  END LOOP;
END $$;`;

if (process.env.RESET_DB_PER_FILE === "true" && isLocalTestDb) {
  beforeAll(async () => {
    const client = createPrismaClient();
    try {
      // TRUNCATE bypasses the append-only FolioLine/Payment row triggers (they
      // fire on UPDATE/DELETE, not TRUNCATE); CASCADE clears the FK graph.
      await client.$executeRawUnsafe(TRUNCATE_ALL);
      await seedDatabase(client, { log: false });
    } finally {
      await client.$disconnect();
    }
  }, 60_000);
}
