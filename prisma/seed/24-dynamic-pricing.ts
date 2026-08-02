/**
 * 24 · Dynamic Pricing — T-2 seed fixtures.
 *
 * specs/24-dynamic-pricing/user-stories.md § Test Fixtures:
 *   CAT-DLX — Deluxe, base ₹4,000, floor ₹3,000, ceil ₹8,000 (guardrails already
 *   seeded by 01-property; reinforced here idempotently so 24 is self-contained).
 *   DATE    — 26 Dec 2026 (high season) carries a SUGGESTED rate above base.
 *
 * Also seeds a default RatePlan for the Deluxe category so the resolution chain
 * (negotiated → dynamic → PLAN → base) has a PLAN rung to exercise.
 *
 * Idempotent: fixed ids + upserts, matching every other seed module.
 */
import type { PrismaClient } from "@prisma/client";
import { PROP_A_ID, CAT_DLX_ID } from "./fixtures";

/** 24 fixture ids — readable so a failing test names the row it means. */
export const RATE_PLAN_DLX_STD_ID = "rateplan_wmg_deluxe_std";
export const DYNAMIC_RATE_DLX_DATE_ID = "dynrate_wmg_deluxe_20261226";

/** DATE fixture — 26 Dec 2026, UTC midnight to match the `@db.Date` column. */
const FIXTURE_DATE = new Date(Date.UTC(2026, 11, 26));

export async function seedDynamicPricing(prisma: PrismaClient): Promise<void> {
  // Reinforce CAT-DLX guardrails (₹3,000 floor / ₹8,000 ceil) — idempotent.
  await prisma.roomCategory.update({
    where: { id: CAT_DLX_ID },
    data: { floorPaise: 300_000, ceilPaise: 800_000 },
  });

  // Default rate plan for Deluxe — the PLAN rung of the resolution chain.
  await prisma.ratePlan.upsert({
    where: { id: RATE_PLAN_DLX_STD_ID },
    create: {
      id: RATE_PLAN_DLX_STD_ID,
      roomCategoryId: CAT_DLX_ID,
      name: "Standard",
      ratePaise: 450_000, // ₹4,500
    },
    update: { ratePaise: 450_000 },
  });

  // A SUGGESTED rate on the high-season DATE, above base — awaits human approval.
  await prisma.dynamicRate.upsert({
    where: { id: DYNAMIC_RATE_DLX_DATE_ID },
    create: {
      id: DYNAMIC_RATE_DLX_DATE_ID,
      propertyId: PROP_A_ID,
      roomCategoryId: CAT_DLX_ID,
      date: FIXTURE_DATE,
      suggestedPaise: 690_000, // ₹6,900 (occ 90% + peak), within the ₹8,000 ceil
      status: "SUGGESTED",
      reason: "occ 90% (x1.25), peak (x1.1)",
    },
    update: { suggestedPaise: 690_000, status: "SUGGESTED", appliedPaise: null, approvedById: null },
  });
}
