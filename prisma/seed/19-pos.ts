/**
 * 19 · POS — T-2 seed fixtures.
 *
 * specs/19-pos/user-stories.md § Test Fixtures: OUT-REST ("Restaurant", 5% F&B)
 * with MENU-1 (Masala Dosa ₹120, HSN 996331, 5%) and MENU-2 (Coffee ₹60, 5%).
 *
 * RES-1 (an IN_HOUSE reservation) and WALKIN are NOT baked in here: the POS
 * integration/e2e suites create their own in-house reservation with unique future
 * dates so they never fight the shared G-RAVI cleanup or the room-overlap
 * exclusion constraint. This file seeds only the stable outlet + menu.
 *
 * Idempotent (fixed ids + upserts), like every other seed module.
 */
import type { PrismaClient } from "@prisma/client";
import { PROP_A_ID } from "./fixtures";

/** OUT-REST — the restaurant outlet at PROP-A. */
export const POS_OUTLET_REST_ID = "outlet_wmg_rest";
/** MENU-1 — Masala Dosa ₹120, HSN 996331, 5%. */
export const MENU_DOSA_ID = "menu_wmg_dosa";
/** MENU-2 — Coffee ₹60, 5%. */
export const MENU_COFFEE_ID = "menu_wmg_coffee";

export async function seedPos(prisma: PrismaClient): Promise<void> {
  await prisma.posOutlet.upsert({
    where: { id: POS_OUTLET_REST_ID },
    create: { id: POS_OUTLET_REST_ID, propertyId: PROP_A_ID, name: "Restaurant", defaultGstBps: 500 },
    update: { name: "Restaurant", defaultGstBps: 500 },
  });

  await prisma.menuItem.upsert({
    where: { id: MENU_DOSA_ID },
    create: { id: MENU_DOSA_ID, propertyId: PROP_A_ID, outletId: POS_OUTLET_REST_ID, name: "Masala Dosa", ratePaise: 12_000, hsnSac: "996331", gstBps: 500, isActive: true },
    update: { name: "Masala Dosa", ratePaise: 12_000, hsnSac: "996331", gstBps: 500 },
  });

  await prisma.menuItem.upsert({
    where: { id: MENU_COFFEE_ID },
    create: { id: MENU_COFFEE_ID, propertyId: PROP_A_ID, outletId: POS_OUTLET_REST_ID, name: "Coffee", ratePaise: 6_000, hsnSac: "996331", gstBps: 500, isActive: true },
    update: { name: "Coffee", ratePaise: 6_000, hsnSac: "996331", gstBps: 500 },
  });
}
