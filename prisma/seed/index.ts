/**
 * Seed entry point — `npm run db:seed` (docs/workflows/seed-data.md).
 *
 * Each module contributes one file here and is invoked in dependency-tier
 * order, mirroring docs/workflows/development-process.md. Only the tiers that
 * are implemented run; later modules register themselves as they are built.
 *
 * The whole dataset is deterministic and idempotent: fixed ids, fixed clock,
 * upserts throughout.
 */
// Must precede any import that reads process.env at module scope (PrismaClient
// resolves DATABASE_URL on construction). The Prisma CLI loads .env itself, but
// this script runs under tsx, which does not.
import "dotenv/config";

import { PrismaClient } from "@prisma/client";
import { seedPlatform } from "./00-platform";
import { seedProperty } from "./01-property";
import { seedGuests } from "./04-guest";
import { seedReservations } from "./03-reservations";
import { seedCommunications } from "./12-communications";
import { seedDynamicPricing } from "./24-dynamic-pricing";
import { seedBookingEngine } from "./23-booking-engine";
import { seedChannels } from "./13-channels";
import { seedPos } from "./19-pos";
import { seedInventory } from "./20-inventory";
import { seedPayroll } from "./21-payroll";
import { seedAccounting } from "./22-accounting";
import { seedCorporate } from "./25-corporate";
import { seedDataOnboarding } from "./26-data-onboarding";
import { seedDemoExtras } from "./27-demo-extras";
import { seedDemoPortfolio } from "./28-demo-portfolio";
import { seedScale } from "./scale";

const prisma = new PrismaClient();

/**
 * Refuse to run against production. The fixtures carry known dev passwords
 * (seed-data.md), so seeding a live database would create usable accounts with
 * publicly-known credentials.
 */
function assertNotProduction(): void {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_PROD_SEED !== "yes") {
    throw new Error(
      "Refusing to seed with NODE_ENV=production — the fixtures use known dev passwords. " +
        "Set ALLOW_PROD_SEED=yes only if you genuinely intend this.",
    );
  }
}

async function main(): Promise<void> {
  assertNotProduction();

  const startedAt = Date.now();
  console.log("Seeding Woodpecker PMS…");

  // Tier 0
  await seedPlatform(prisma);
  console.log("  ✔ 00-platform  (org, security settings, 2 properties, 6 users)");

  await seedProperty(prisma);
  console.log("  ✔ 01-property   (3 floors, 2 categories, ROOMS-A: 10 rooms)");

  await seedGuests(prisma);
  console.log("  ✔ 04-guest      (G-RAVI, G-RAVI2 duplicate, G-MEHTA)");

  // Tier 1
  await seedReservations(prisma);
  console.log("  ✔ 03-reservation (ACME corporate + G-MEHTA link)");

  // Tier 4
  await seedCommunications(prisma);
  console.log("  ✔ 12-communications (templates, automations, consents, sandbox account)");

  // Tier 5
  await seedDynamicPricing(prisma);
  console.log("  ✔ 24-dynamic-pricing (Deluxe rate plan + SUGGESTED rate)");

  await seedBookingEngine(prisma);
  console.log("  ✔ 23-booking-engine (published config, slug woodpecker-mg)");

  await seedChannels(prisma);
  console.log("  ✔ 13-channels    (CH-BDC sandbox, MAP-DLX, RES-EXT fixture)");

  // Tier 6
  await seedPos(prisma);
  console.log("  ✔ 19-pos        (OUT-REST outlet + Masala Dosa/Coffee menu)");

  await seedInventory(prisma);
  console.log("  ✔ 20-inventory   (I-RICE, I-COFFEE, coffee recipe)");

  await seedPayroll(prisma);
  console.log("  ✔ 21-payroll    (S-ANU, S-LATE, S-EX, attendance+OT, ADV-ANU)");

  await seedAccounting(prisma);
  console.log("  ✔ 22-accounting  (PROV zoho sandbox + GL mappings)");

  // Tier 7
  await seedCorporate(prisma);
  console.log("  ✔ 25-corporate  (TA-SKY 10%, NEG-DLX ₹3,500 for ACME)");

  await seedDataOnboarding(prisma);
  console.log("  ✔ 26-data-onboarding (sample import files)");

  await seedDemoExtras(prisma);
  console.log("  ✔ 27-demo-extras (owner payouts, renewal dates, laundry batches, field-staff)");

  await seedDemoPortfolio(prisma);
  console.log("  ✔ 28-demo-portfolio (5 hotels + managers + 30-day snapshots)");

  // Later modules register here as they are implemented.

  // Opt-in scale seed (seed-data.md): `npm run db:seed -- --scale`.
  // 100k guests for the FR-10 p95<500ms search test. Off by default — it is
  // slow and adds real DB load; the timed run is deferred to staging.
  if (process.argv.includes("--scale")) {
    console.log("  … generating scale dataset (100k guests) …");
    await seedScale(prisma);
  }

  console.log(`Seed complete in ${Date.now() - startedAt}ms.`);
}

main()
  .catch((e: unknown) => {
    console.error("Seed failed:", e);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
