/**
 * Add-on / upsell catalog (Wave 3) — a small set of paid extras for the flagship
 * property so the guest booking page and the reception inbox are never empty.
 * Base fixture (not gated behind SEED_DEMO): tests and the app both need a catalog.
 * Idempotent via fixed ids. GST is derived from each item's charge type at posting.
 */
import type { PrismaClient } from "@prisma/client";
import { PROP_A_ID } from "./fixtures";

type SeedAddOn = {
  id: string;
  name: string;
  description: string;
  pricePaise: number;
  chargeType: "AIRPORT_TRANSFER" | "EXTRA_BED" | "FOOD" | "MISC";
  sortOrder: number;
};

const ADD_ONS: SeedAddOn[] = [
  { id: "addon_a_airport", name: "Airport pickup", description: "Private cab from the airport to the property.", pricePaise: 120_000, chargeType: "AIRPORT_TRANSFER", sortOrder: 10 },
  { id: "addon_a_breakfast", name: "Breakfast (per person)", description: "Daily buffet breakfast added to your stay.", pricePaise: 35_000, chargeType: "FOOD", sortOrder: 20 },
  { id: "addon_a_extrabed", name: "Extra bed", description: "An additional bed made up in your room.", pricePaise: 80_000, chargeType: "EXTRA_BED", sortOrder: 30 },
  { id: "addon_a_earlyci", name: "Early check-in", description: "Guaranteed room access before the standard time.", pricePaise: 100_000, chargeType: "MISC", sortOrder: 40 },
  { id: "addon_a_lateco", name: "Late checkout", description: "Keep your room until the early evening.", pricePaise: 100_000, chargeType: "MISC", sortOrder: 50 },
];

export async function seedAddOns(prisma: PrismaClient): Promise<void> {
  for (const a of ADD_ONS) {
    await prisma.addOn.upsert({
      where: { id: a.id },
      update: { name: a.name, description: a.description, pricePaise: a.pricePaise, chargeType: a.chargeType, sortOrder: a.sortOrder, active: true },
      create: {
        id: a.id,
        propertyId: PROP_A_ID,
        name: a.name,
        description: a.description,
        pricePaise: a.pricePaise,
        chargeType: a.chargeType,
        sortOrder: a.sortOrder,
      },
    });
  }
}
