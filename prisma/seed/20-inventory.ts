/**
 * 20 · Inventory (Stock) — T-2 seed fixtures.
 *
 * specs/20-inventory-stock/user-stories.md § Test Fixtures:
 *   I-RICE    Rice, unit kg, reorderLevel 20, on-hand 25
 *   I-COFFEE  Coffee beans, reorderLevel 5, on-hand 5.5 (deliberately off the boundary)
 *   RECIPE    Coffee (menu) consumes 0.02 kg coffee beans per cup
 *
 * Fixture ids live HERE (not prisma/seed/fixtures.ts) so this module owns its
 * dataset and does not contend with other agents editing the shared file.
 *
 * `RecipeComponent.menuItemId` has NO FK to MenuItem in the schema, so the
 * recipe references a stable menu-item id string without needing a 19 PosOutlet
 * /MenuItem row — 20 stays strictly inside its own tables.
 *
 * On-hand is seeded both as the cached column AND as an opening ADJUST movement
 * (with a fixed ref so re-seeding is idempotent), keeping cache == Σ movements.
 */
import type { PrismaClient } from "@prisma/client";
import { PROP_A_ID } from "./fixtures";

export const I_RICE_ID = "inv_wmg_rice";
export const I_COFFEE_ID = "inv_wmg_coffee";
/** Free string id (no MenuItem FK) — the "Coffee" menu item the recipe maps. */
export const MENU_COFFEE_ID = "menu_wmg_coffee";
export const RECIPE_COFFEE_ID = "recipe_wmg_coffee";

/** Coffee recipe: 0.02 kg coffee beans per cup (AC-4). */
export const COFFEE_QTY_PER_CUP = 0.02;

const ITEMS = [
  { id: I_RICE_ID, name: "Rice", unit: "kg", domain: "KITCHEN", category: "Provisions", onHand: 25, reorderLevel: 20 },
  { id: I_COFFEE_ID, name: "Coffee beans", unit: "kg", domain: "KITCHEN", category: "Provisions", onHand: 5.5, reorderLevel: 5 },
];

export async function seedInventory(prisma: PrismaClient): Promise<void> {
  for (const it of ITEMS) {
    await prisma.inventoryItem.upsert({
      where: { propertyId_name: { propertyId: PROP_A_ID, name: it.name } },
      update: { unit: it.unit, domain: it.domain as never, category: it.category, onHand: it.onHand, reorderLevel: it.reorderLevel },
      create: {
        id: it.id,
        propertyId: PROP_A_ID,
        name: it.name,
        unit: it.unit,
        domain: it.domain as never,
        category: it.category,
        onHand: it.onHand,
        reorderLevel: it.reorderLevel,
      },
    });
    // Opening balance as a movement — fixed ref keeps re-seed idempotent.
    await prisma.inventoryMovement.upsert({
      where: { refType_refId_itemId: { refType: "Seed", refId: "opening", itemId: it.id } },
      update: { delta: it.onHand },
      create: { itemId: it.id, delta: it.onHand, reason: "ADJUST", refType: "Seed", refId: "opening" },
    });
  }

  await prisma.recipeComponent.upsert({
    where: { menuItemId_itemId: { menuItemId: MENU_COFFEE_ID, itemId: I_COFFEE_ID } },
    update: { qtyPerUnit: COFFEE_QTY_PER_CUP },
    create: { id: RECIPE_COFFEE_ID, menuItemId: MENU_COFFEE_ID, itemId: I_COFFEE_ID, qtyPerUnit: COFFEE_QTY_PER_CUP },
  });
}
