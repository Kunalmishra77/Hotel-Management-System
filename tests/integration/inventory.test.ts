/**
 * 20 inventory integration — T-6..T-10 (FR-1/2/3/4/5/6, AC-1/2/3/4/5/6/7/8/9/11).
 * Auth mocked at the boundary (housekeeping/reports pattern). All rows use a
 * per-run-unique suffix so the shared DB and concurrent agents never collide,
 * and are cleaned in afterAll.
 */
import { vi } from "vitest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createPrismaClient } from "@/lib/db/client";
import type { SessionClaims } from "@/lib/auth/claims";

const authMock = vi.hoisted(() => ({ current: null as SessionClaims | null }));
vi.mock("@/lib/auth", () => ({
  requireUser: async () => {
    if (!authMock.current) throw new Error("no user");
    return authMock.current;
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

import { PROP_A_ID, ORG_ID, USER_MANAGER_ID, USER_HOUSEKEEPING_ID } from "../../prisma/seed/fixtures";
import { assembleClaims } from "@/lib/auth/claims";
import { createItem, recordMovement, adjustStock } from "@/features/inventory/actions";
import { inventoryConsumer } from "@/features/inventory/consumer";

const prisma = createPrismaClient();
const RUN = `${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
const N = (base: string) => `ZZ_${base}_${RUN}`; // ZZ_ prefix keeps demo lists tidy

const createdItemIds = new Set<string>();
const menuIds = new Set<string>();

async function actAs(userId: string): Promise<SessionClaims> {
  const c = await assembleClaims(prisma, userId);
  if (!c) throw new Error("no claims");
  authMock.current = c;
  return c;
}

/** Directly seed an item (explicit id) + optional recipe for the consumer tests. */
async function seedItem(opts: { name: string; onHand: number; reorderLevel: number }): Promise<string> {
  const item = await prisma.inventoryItem.create({
    data: { propertyId: PROP_A_ID, name: N(opts.name), unit: "kg", category: "Test", onHand: opts.onHand, reorderLevel: opts.reorderLevel },
    select: { id: true },
  });
  createdItemIds.add(item.id);
  return item.id;
}

beforeEach(() => { authMock.current = null; });

afterAll(async () => {
  const ids = [...createdItemIds];
  await prisma.inventoryMovement.deleteMany({ where: { itemId: { in: ids } } });
  await prisma.recipeComponent.deleteMany({ where: { itemId: { in: ids } } });
  await prisma.inventoryItem.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});

describe("createItem (T-6, FR-1, AC-1/3)", () => {
  it("persists a new item with on-hand starting at 0 (AC-1)", async () => {
    await actAs(USER_MANAGER_ID);
    const res = await createItem({ propertyId: PROP_A_ID, name: N("Rice"), unit: "kg", category: "Provisions", reorderLevel: 20 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    createdItemIds.add(res.data.id);
    const row = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: res.data.id } });
    expect(row.onHand).toBe(0);
    expect(row.reorderLevel).toBe(20);
  });

  it("rejects a duplicate name in the same property (AC-3)", async () => {
    await actAs(USER_MANAGER_ID);
    const first = await createItem({ propertyId: PROP_A_ID, name: N("Sugar"), unit: "kg", category: "Provisions", reorderLevel: 5 });
    expect(first.ok).toBe(true);
    if (first.ok) createdItemIds.add(first.data.id);
    const dup = await createItem({ propertyId: PROP_A_ID, name: N("Sugar"), unit: "kg", category: "Provisions", reorderLevel: 5 });
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.error.code).toBe("CONFLICT");
  });
});

describe("recordMovement (T-7, FR-2/5, AC-2/6/11)", () => {
  it("posts a purchase and reconciles on-hand (AC-2: 25 + 50 = 75)", async () => {
    const itemId = await seedItem({ name: "RicePurchase", onHand: 25, reorderLevel: 20 });
    await actAs(USER_MANAGER_ID);
    const res = await recordMovement({ itemId, delta: 50, reason: "PURCHASE" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.onHand).toBe(75);
    expect(res.data.applied).toBe(true);
    expect((await prisma.inventoryItem.findUniqueOrThrow({ where: { id: itemId } })).onHand).toBe(75);
  });

  it("posts a purchase referencing a 07 expense (AC-11)", async () => {
    const itemId = await seedItem({ name: "ExpensePurchase", onHand: 0, reorderLevel: 0 });
    await actAs(USER_MANAGER_ID);
    const res = await recordMovement({ itemId, delta: 12, reason: "PURCHASE", refType: "Expense", refId: `exp_${RUN}` });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.onHand).toBe(12);
    const mv = await prisma.inventoryMovement.findFirstOrThrow({ where: { itemId, refType: "Expense" } });
    expect(mv.delta).toBe(12);
  });

  it("rejects a consumption that would take stock below zero (AC-6, NEGATIVE_STOCK)", async () => {
    const itemId = await seedItem({ name: "NegGuard", onHand: 10, reorderLevel: 0 });
    await actAs(USER_MANAGER_ID);
    const res = await recordMovement({ itemId, delta: -20, reason: "CONSUMPTION" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("NEGATIVE_STOCK");
    // Unchanged — the guard fires before any write.
    expect((await prisma.inventoryItem.findUniqueOrThrow({ where: { id: itemId } })).onHand).toBe(10);
  });
});

describe("adjustStock (AC-9)", () => {
  it("reconciles on-hand to the counted quantity via an ADJUST movement", async () => {
    const itemId = await seedItem({ name: "StockTake", onHand: 30, reorderLevel: 0 });
    await actAs(USER_MANAGER_ID);
    const res = await adjustStock({ itemId, countedQuantity: 27.5 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.onHand).toBe(27.5);
    const mv = await prisma.inventoryMovement.findFirstOrThrow({ where: { itemId, reason: "ADJUST" }, orderBy: { createdAt: "desc" } });
    expect(mv.delta).toBe(-2.5);
    const audit = await prisma.auditLog.findFirst({ where: { entityId: itemId, action: "inventory:adjust" } });
    expect(audit).not.toBeNull();
  });
});

describe("PosOrderSettled consumer (T-8/T-9, FR-3/4, AC-4/5/8/10)", () => {
  async function seedCoffee(name: string, onHand: number) {
    const itemId = await seedItem({ name, onHand, reorderLevel: 5 });
    const menuItemId = `menu_${name}_${RUN}`;
    menuIds.add(menuItemId);
    await prisma.recipeComponent.create({ data: { menuItemId, itemId, qtyPerUnit: 0.02 } });
    return { itemId, menuItemId };
  }

  it("deducts per recipe and fires LowStockDetected on crossing (AC-4/5)", async () => {
    const { itemId, menuItemId } = await seedCoffee("Coffee", 5.5);
    const posOrderId = `pos_${RUN}_a`;
    await inventoryConsumer.handle({
      id: "ev-a", seq: 1n, type: "PosOrderSettled", orgId: ORG_ID, propertyId: PROP_A_ID,
      aggregateId: posOrderId, payload: { posOrderId, propertyId: PROP_A_ID, items: [{ menuItemId, quantity: 50 }] }, occurredAt: new Date(),
    });
    expect((await prisma.inventoryItem.findUniqueOrThrow({ where: { id: itemId } })).onHand).toBe(4.5);
    const low = await prisma.domainEvent.findFirst({ where: { type: "LowStockDetected", aggregateId: itemId } });
    expect(low).not.toBeNull();
  });

  it("is idempotent on re-delivery — deducts EXACTLY once (AC-8)", async () => {
    const { itemId, menuItemId } = await seedCoffee("CoffeeIdem", 5.5);
    const posOrderId = `pos_${RUN}_b`;
    const env = {
      id: "ev-b", seq: 2n, type: "PosOrderSettled", orgId: ORG_ID, propertyId: PROP_A_ID,
      aggregateId: posOrderId, payload: { posOrderId, propertyId: PROP_A_ID, items: [{ menuItemId, quantity: 50 }] }, occurredAt: new Date(),
    };
    await inventoryConsumer.handle(env);
    await inventoryConsumer.handle({ ...env, id: "ev-b2" }); // same order id, re-delivered
    expect((await prisma.inventoryItem.findUniqueOrThrow({ where: { id: itemId } })).onHand).toBe(4.5);
    const count = await prisma.inventoryMovement.count({ where: { refType: "PosOrder", refId: posOrderId, itemId } });
    expect(count).toBe(1);
  });

  it("does NOT fire LowStockDetected when landing exactly on the reorder level (strict <)", async () => {
    const { itemId, menuItemId } = await seedCoffee("CoffeeBoundary", 6); // 6 - 50*0.02(=1) = 5 == reorder
    const posOrderId = `pos_${RUN}_c`;
    await inventoryConsumer.handle({
      id: "ev-c", seq: 3n, type: "PosOrderSettled", orgId: ORG_ID, propertyId: PROP_A_ID,
      aggregateId: posOrderId, payload: { posOrderId, items: [{ menuItemId, quantity: 50 }] }, occurredAt: new Date(),
    });
    expect((await prisma.inventoryItem.findUniqueOrThrow({ where: { id: itemId } })).onHand).toBe(5);
    const low = await prisma.domainEvent.findFirst({ where: { type: "LowStockDetected", aggregateId: itemId } });
    expect(low).toBeNull();
  });

  it("skips a menu item with no recipe but deducts the others (AC-10)", async () => {
    const { itemId, menuItemId } = await seedCoffee("CoffeeSkip", 5.5);
    const posOrderId = `pos_${RUN}_d`;
    await inventoryConsumer.handle({
      id: "ev-d", seq: 4n, type: "PosOrderSettled", orgId: ORG_ID, propertyId: PROP_A_ID,
      aggregateId: posOrderId, payload: { posOrderId, items: [{ menuItemId, quantity: 10 }, { menuItemId: `nomap_${RUN}`, quantity: 3 }] }, occurredAt: new Date(),
    });
    // Coffee still deducts (5.5 - 10*0.02 = 5.3); the un-mapped item is skipped, no crash.
    expect((await prisma.inventoryItem.findUniqueOrThrow({ where: { id: itemId } })).onHand).toBe(5.3);
  });
});

describe("RBAC (T-10, FR-6, AC-7)", () => {
  it("denies a role without inventory:manage (Housekeeping)", async () => {
    await actAs(USER_HOUSEKEEPING_ID);
    const res = await createItem({ propertyId: PROP_A_ID, name: N("Denied"), unit: "kg", category: "Test", reorderLevel: 1 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("FORBIDDEN");
  });

  it("denies recordMovement for an unauthorized role", async () => {
    const itemId = await seedItem({ name: "RbacMove", onHand: 5, reorderLevel: 0 });
    await actAs(USER_HOUSEKEEPING_ID);
    const res = await recordMovement({ itemId, delta: 5, reason: "PURCHASE" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("FORBIDDEN");
  });
});
