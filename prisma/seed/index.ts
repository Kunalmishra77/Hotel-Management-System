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
import { seedAddOns } from "./add-ons";
import { seedPortfolioFill } from "./portfolio-fill";
import { seedDemoExtras } from "./27-demo-extras";
import { seedDemoPortfolio } from "./28-demo-portfolio";
import { seedDemoRich } from "./29-demo-rich";
import { seedDemoCustomer } from "./30-demo-customer";
import { seedDemoHauzKhas } from "./31-demo-hauzkhas";
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

/**
 * Seed the full minimal fixture into `client` (tiers 00–26). Exported so tests can
 * re-seed a freshly-reset dedicated DB per file (see `tests/integration-reset.ts`).
 * `SEED_DEMO=false` skips the demo-only enrichment (27/28) that pollutes fixture
 * state. `log:false` silences per-step output for the per-file reseed.
 */
export async function seedDatabase(client: PrismaClient, opts: { log?: boolean } = {}): Promise<void> {
  const say = (m: string) => { if (opts.log ?? true) console.log(m); };

  // Tier 0
  await seedPlatform(client);
  say("  ✔ 00-platform  (org, security settings, 2 properties, 6 users)");
  await seedProperty(client);
  say("  ✔ 01-property   (3 floors, 2 categories, ROOMS-A: 10 rooms)");
  await seedGuests(client);
  say("  ✔ 04-guest      (G-RAVI, G-RAVI2 duplicate, G-MEHTA)");
  // Tier 1
  await seedReservations(client);
  say("  ✔ 03-reservation (ACME corporate + G-MEHTA link)");
  // Tier 4
  await seedCommunications(client);
  say("  ✔ 12-communications (templates, automations, consents, sandbox account)");
  // Tier 5
  await seedDynamicPricing(client);
  say("  ✔ 24-dynamic-pricing (Deluxe rate plan + SUGGESTED rate)");
  await seedBookingEngine(client);
  say("  ✔ 23-booking-engine (published config, slug woodpecker-mg)");
  await seedAddOns(client);
  say("  ✔ add-ons        (5 upsell extras for PROP_A)");
  await seedChannels(client);
  say("  ✔ 13-channels    (CH-BDC sandbox, MAP-DLX, RES-EXT fixture)");
  // Tier 6
  await seedPos(client);
  say("  ✔ 19-pos        (OUT-REST outlet + Masala Dosa/Coffee menu)");
  await seedInventory(client);
  say("  ✔ 20-inventory   (I-RICE, I-COFFEE, coffee recipe)");
  await seedPayroll(client);
  say("  ✔ 21-payroll    (S-ANU, S-LATE, S-EX, attendance+OT, ADV-ANU)");
  await seedAccounting(client);
  say("  ✔ 22-accounting  (PROV zoho sandbox + GL mappings)");
  // Tier 7
  await seedCorporate(client);
  say("  ✔ 25-corporate  (TA-SKY 10%, NEG-DLX ₹3,500 for ACME)");
  await seedDataOnboarding(client);
  say("  ✔ 26-data-onboarding (sample import files)");

  // Demo-only enrichment (owner payouts, 5-hotel portfolio, extra staff, in-house
  // bookings) makes the live demo look full, but it pollutes the minimal fixture
  // state the integration tests assert against. Skip it for the test database.
  //
  // Three modes via SEED_DEMO:
  //   "false" → no enrichment (integration tests).
  //   "lite"  → a CLEAN, small single-property demo: skips the multi-hotel
  //             inflators (27/28/portfolio-fill add 4-5 hotels, ~70 guests, ~80
  //             bookings) and keeps only the MG-Road demo (29) + login guest (30).
  //             Use this for a tidy live demo — ~1-2 properties, not 13.
  //   default → the full multi-hotel demo.
  const demoLite = process.env.SEED_DEMO === "lite";
  // "hauzkhas" → the client's real 4-property Hauz Khas portfolio at
  // India-realistic scale (16 rooms, low-lakh monthly revenue). Skips every
  // generic multi-hotel inflator (27/28/portfolio-fill/29) which model large
  // hotels and would drown the small real numbers.
  const demoHauzKhas = process.env.SEED_DEMO === "hauzkhas";
  if (process.env.SEED_DEMO !== "false") {
    if (demoHauzKhas) {
      await seedDemoHauzKhas(client);
      say("  ✔ 31-demo-hauzkhas (4 Hauz Khas blocks · 16 rooms · ₹2.5-3.5k tariffs · realistic bookings)");
      await seedDemoCustomer(client);
      say("  ✔ 30-demo-customer (login-able guest account + in-room request, lost&found, expense to approve)");
    } else {
      if (!demoLite) {
        await seedDemoExtras(client);
        say("  ✔ 27-demo-extras (owner payouts, renewal dates, laundry batches, field-staff)");
        await seedDemoPortfolio(client);
        say("  ✔ 28-demo-portfolio (5 hotels + managers + 30-day snapshots)");
        await seedPortfolioFill(client);
        say("  ✔ portfolio-fill (rooms + guests + bookings for the 4 non-flagship hotels)");
      } else {
        say("  · lite demo: skipping multi-hotel enrichment (27-extras, 28-portfolio, portfolio-fill)");
      }
      await seedDemoRich(client);
      say("  ✔ 29-demo-rich (15 rooms, 28 guests, 54 reservations, folios+payments, HK/maint/feedback)");
      await seedDemoCustomer(client);
      say("  ✔ 30-demo-customer (login-able guest account + in-room request, lost&found, a major expense to approve)");
    }
  } else {
    say("  · demo seeds skipped (SEED_DEMO=false)");
  }
}

async function main(): Promise<void> {
  assertNotProduction();

  const startedAt = Date.now();
  console.log("Seeding Woodpecker PMS…");
  await seedDatabase(prisma);

  // Opt-in scale seed (seed-data.md): `npm run db:seed -- --scale`.
  // 100k guests for the FR-10 p95<500ms search test. Off by default — it is
  // slow and adds real DB load; the timed run is deferred to staging.
  if (process.argv.includes("--scale")) {
    console.log("  … generating scale dataset (100k guests) …");
    await seedScale(prisma);
  }

  console.log(`Seed complete in ${Date.now() - startedAt}ms.`);
}

// Auto-run only as the CLI seed. When imported under Vitest (the per-file test
// reset imports `seedDatabase`), do NOT run the full CLI main().
if (!process.env.VITEST) {
  main()
    .catch((e: unknown) => {
      console.error("Seed failed:", e);
      process.exitCode = 1;
    })
    .finally(() => {
      void prisma.$disconnect();
    });
}
