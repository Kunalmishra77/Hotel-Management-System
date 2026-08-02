/**
 * 20-inventory T-12 — journey: stock in → POS settle → stock deducts → low-stock
 * alert (AC-2/4/5), mobile viewport. Manager role (has inventory:manage). The
 * POS settle is simulated by invoking the consumer against a seeded recipe (20 is
 * decoupled from 19 — it consumes PosOrderSettled, never drives POS from the UI).
 */
import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { inventoryConsumer } from "../../src/features/inventory/consumer";

const MG = { email: "manager.mg@woodpecker.example", password: "woodpecker-dev-2026" };
const PROP_A_ID = "prop_wmg";
const ORG_ID = "org_woodpecker";
const RUN = `${Date.now().toString(36)}`;
const ITEM_NAME = `E2E Coffee ${RUN}`;
const MENU_ID = `menu_e2e_${RUN}`;
const POS_ID = `pos_e2e_${RUN}`;

let itemId = "";

test.beforeAll(async () => {
  const prisma = new PrismaClient();
  try {
    const item = await prisma.inventoryItem.create({
      data: { propertyId: PROP_A_ID, name: ITEM_NAME, unit: "kg", category: "E2E", onHand: 0, reorderLevel: 5 },
      select: { id: true },
    });
    itemId = item.id;
    await prisma.recipeComponent.create({ data: { menuItemId: MENU_ID, itemId, qtyPerUnit: 0.02 } });
  } finally {
    await prisma.$disconnect();
  }
});

test.afterAll(async () => {
  const prisma = new PrismaClient();
  try {
    await prisma.inventoryMovement.deleteMany({ where: { itemId } });
    await prisma.recipeComponent.deleteMany({ where: { itemId } });
    await prisma.inventoryItem.deleteMany({ where: { id: itemId } });
  } finally {
    await prisma.$disconnect();
  }
});

async function signIn(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(MG.email);
  await page.getByLabel("Password").fill(MG.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

test.describe("inventory journey — stock in → POS settle → deduct → low (T-12)", () => {
  test("purchase raises on-hand, a settled order deducts it, and low-stock shows", async ({ page }) => {
    await signIn(page);
    await page.goto("/inventory");

    // 1 · The seeded item appears; stock in 6 kg (AC-2)
    const row = page.getByTestId(`stock-${itemId}`);
    await expect(row).toBeVisible();
    await page.getByTestId(`qty-${itemId}`).fill("6");
    await page.getByTestId(`stockin-${itemId}`).click();
    await expect(page.getByTestId(`onhand-${itemId}`)).toContainText("6");

    // 2 · Simulate a POS order settling: 50 cups × 0.02 kg = 1 kg deducted (AC-4)
    await inventoryConsumer.handle({
      id: `ev_${RUN}`, seq: 1n, type: "PosOrderSettled", orgId: ORG_ID, propertyId: PROP_A_ID,
      aggregateId: POS_ID, payload: { posOrderId: POS_ID, propertyId: PROP_A_ID, items: [{ menuItemId: MENU_ID, quantity: 50 }] }, occurredAt: new Date(),
    });

    // 3 · Reload — on-hand is now 5 (6 − 1). Deduct one more to cross below reorder 5.
    await page.reload();
    await expect(page.getByTestId(`onhand-${itemId}`)).toContainText("5");
    await page.getByTestId(`qty-${itemId}`).fill("1");
    await page.getByTestId(`count-${itemId}`).click(); // set counted quantity to 1 (stock-take)

    // 4 · On-hand 1 < reorder 5 → the low-stock badge shows (AC-5)
    await expect(page.getByTestId(`low-${itemId}`)).toBeVisible();
  });
});
