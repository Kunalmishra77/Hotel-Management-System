/**
 * CLEAN production seed — the client's starting point, with NO demo transactions.
 *
 * Creates only the structure the client needs to begin: the organization + security
 * settings, the staff logins, and the four real Hauz Khas properties with their
 * floors, room categories (with tariffs) and 16 rooms (all VACANT). It creates
 * ZERO guests, bookings, folios, invoices, expenses — the client fills those in
 * through the app (New booking / Data Entry / Import & Export).
 *
 * Run (after wiping the DB):
 *   ALLOW_PROD_SEED=yes npx tsx prisma/seed/clean.ts
 *
 * Idempotent (upserts). It does NOT run the demo fixture seeds (03/04/…), so no
 * demo guest or reservation is ever created.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { seedPlatform } from "./00-platform";
import { seedProperty } from "./01-property";
import { seedHauzKhasStructure } from "./31-demo-hauzkhas";

const prisma = new PrismaClient();

function assertAllowed(): void {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_PROD_SEED !== "yes") {
    throw new Error("Refusing to seed with NODE_ENV=production — set ALLOW_PROD_SEED=yes to proceed.");
  }
}

async function main(): Promise<void> {
  assertAllowed();
  console.log("Seeding CLEAN production structure (no demo data)…");
  await seedPlatform(prisma);
  console.log("  ✔ organization, security settings, staff logins");
  await seedProperty(prisma);
  console.log("  ✔ base property scaffold");
  await seedHauzKhasStructure(prisma, { cleanStatuses: true });
  console.log("  ✔ 4 Hauz Khas properties · floors · room categories · 16 rooms (all vacant)");
  console.log("Done. No guests, bookings, folios or invoices — the client adds those in the app.");
}

main()
  .catch((e: unknown) => {
    console.error("Clean seed failed:", e);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
