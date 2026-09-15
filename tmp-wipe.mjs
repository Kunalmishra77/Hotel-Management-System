/**
 * Throwaway LIVE wipe — clears ALL data so the CLEAN production seed can set up
 * an empty, client-ready structure. TRUNCATE (not DELETE) because folio lines /
 * payments / audit / events are append-only.
 *
 * Run once, then tell Claude to run the clean seed:
 *   $env:CONFIRM="WIPE"; node tmp-wipe.mjs          (PowerShell)
 *   CONFIRM=WIPE node tmp-wipe.mjs                    (Git Bash)
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

if (process.env.CONFIRM !== "WIPE") {
  console.error("Refusing to wipe. Re-run with CONFIRM=WIPE to proceed.");
  process.exit(1);
}

const prisma = new PrismaClient();
const rows = await prisma.$queryRawUnsafe(
  `SELECT tablename FROM pg_tables
   WHERE schemaname = 'public'
     AND tablename NOT LIKE '\\_prisma%'
     AND tablename NOT LIKE 'pgboss%'`,
);
const tables = rows.map((r) => `"public"."${r.tablename}"`);
if (tables.length === 0) { console.log("No tables to truncate."); process.exit(0); }
console.log(`Truncating ${tables.length} tables…`);
await prisma.$executeRawUnsafe(`TRUNCATE ${tables.join(", ")} RESTART IDENTITY CASCADE`);
console.log("✔ Wipe complete. Now tell Claude to run the CLEAN seed.");
await prisma.$disconnect();
