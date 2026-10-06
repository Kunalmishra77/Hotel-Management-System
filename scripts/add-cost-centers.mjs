/**
 * Create the non-hotel COST-CENTRES used to record overhead expenses:
 *   A2 Office · Woodpecker (Head Office) · Other
 * These carry isCostCenter=true, so they appear ONLY in the expense property
 * picker (hidden from every hotel chooser / occupancy / per-hotel profit) and
 * their expenses show as a separate "Overheads" line in Profit reports.
 *
 * Run AFTER deploying the migration (prisma migrate deploy adds Property.isCostCenter).
 * Dry-run:  node scripts/add-cost-centers.mjs
 * Apply:    $env:CONFIRM="YES"; node scripts/add-cost-centers.mjs
 * Idempotent: skips any code that already exists.
 */
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const APPLY = process.env.CONFIRM === "YES";

const CENTERS = [
  { code: "A2OFF", name: "A2 Office", addressLine1: "A2 Office", city: "New Delhi", state: "Delhi", pincode: "110016" },
  { code: "WPHO", name: "Woodpecker (Head Office)", addressLine1: "Woodpecker Head Office", city: "New Delhi", state: "Delhi", pincode: "110016" },
  { code: "OTHER", name: "Other", addressLine1: "Other", city: "New Delhi", state: "Delhi", pincode: "110016" },
];

try {
  // Use any existing property to discover the org.
  const anchor = await prisma.property.findFirst({ select: { orgId: true } });
  if (!anchor) throw new Error("No existing property found — cannot resolve orgId.");
  const orgId = anchor.orgId;

  for (const c of CENTERS) {
    const existing = await prisma.property.findFirst({ where: { orgId, code: c.code }, select: { id: true, isCostCenter: true } });
    if (existing) {
      console.log(`• ${c.code} (${c.name}) already exists [${existing.id}] isCostCenter=${existing.isCostCenter}` + (existing.isCostCenter ? "" : "  ⚠ exists as a HOTEL — not touching"));
      continue;
    }
    console.log(`+ would create cost-centre ${c.code} — ${c.name}`);
    if (APPLY) {
      const created = await prisma.property.create({
        data: { orgId, isCostCenter: true, country: "India", timezone: "Asia/Kolkata", ...c },
        select: { id: true },
      });
      console.log(`  ✅ created [${created.id}]`);
    }
  }
  if (!APPLY) console.log("\nDRY RUN — nothing written. Re-run with CONFIRM=YES to apply.");
  else console.log("\nDone. Cost-centres now appear in the Expenses property picker.");
} catch (e) {
  console.error("Failed:", e.message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
