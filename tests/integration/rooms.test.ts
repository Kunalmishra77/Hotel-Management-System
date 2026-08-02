/**
 * Traceability: 02 T-6..T-12 — FR-1/2/3/4/5/6/7/8/9/10,
 * AC-1/2/3/4/5/6/7/8/9/10/12/13/14.
 */
import { Prisma } from "@prisma/client";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPrismaClient } from "@/lib/db/client";
import {
  CAT_DLX_ID,
  CAT_STE_ID,
  PROP_A_ID,
  PROP_B_ID,
  ROOM_101_ID,
  ROOM_201_ID,
  ROOM_202_ID,
  USER_ADMIN_ID,
  USER_HOUSEKEEPING_ID,
  USER_MANAGER_ID,
  USER_RECEPTION_A_ID,
} from "../../prisma/seed/fixtures";
import { resetRoomsA } from "../../prisma/seed/01-property";
import { assembleClaims } from "@/lib/auth/claims";
import { authorize } from "@/lib/permissions";
import { ForbiddenError, OutOfScopeError } from "@/lib/errors";
import { listCategories, listRoomBlocks, roomBoard } from "@/features/rooms/queries";
import { canTransitionAsRole } from "@/features/rooms/domain/transitions";
import { isRoomBlockedDuring } from "@/features/rooms/domain/blocks";

const prisma = createPrismaClient();

/** Rows created by these tests; ids are prefixed so cleanup is unambiguous. */
const TEST_PREFIX = "t02_";

async function claimsFor(userId: string) {
  const claims = await assembleClaims(prisma, userId);
  if (!claims) throw new Error(`no claims for ${userId}`);
  return claims;
}

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

beforeEach(async () => {
  await resetRoomsA(prisma);
});

afterEach(async () => {
  await prisma.roomBlock.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
  await prisma.room.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
  await prisma.roomCategory.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
  await resetRoomsA(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("categories (FR-1 / AC-1)", () => {
  it("seeds CAT-DLX at ₹4,000 with the documented occupancy and HSN", async () => {
    const category = await prisma.roomCategory.findUniqueOrThrow({ where: { id: CAT_DLX_ID } });
    expect(category.name).toBe("Deluxe");
    // Money is integer paise, never a float (data-model.md).
    expect(category.baseRatePaise).toBe(400_000);
    expect(Number.isInteger(category.baseRatePaise)).toBe(true);
    expect(category.maxAdults).toBe(2);
    expect(category.maxChildren).toBe(1);
    expect(category.hsnSac).toBe("996311");
  });

  it("seeds CAT-STE at ₹7,000", async () => {
    const suite = await prisma.roomCategory.findUniqueOrThrow({ where: { id: CAT_STE_ID } });
    expect(suite.baseRatePaise).toBe(700_000);
  });

  it("rejects a duplicate category name within the property", async () => {
    await expect(
      prisma.roomCategory.create({
        data: { id: `${TEST_PREFIX}dup`, propertyId: PROP_A_ID, name: "Deluxe", baseRatePaise: 1 },
      }),
    ).rejects.toSatisfy(
      (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002",
    );
  });

  it("allows the same category name in a different property", async () => {
    const created = await prisma.roomCategory.create({
      data: { id: `${TEST_PREFIX}b`, propertyId: PROP_B_ID, name: "Deluxe", baseRatePaise: 400_000 },
    });
    expect(created.id).toBeTruthy();
  });

  it("lists categories with their room counts", async () => {
    const admin = await claimsFor(USER_ADMIN_ID);
    const categories = await listCategories(admin, PROP_A_ID);
    const deluxe = categories.find((c) => c.id === CAT_DLX_ID);
    expect(deluxe?.roomCount).toBe(5); // rooms 101-105
  });
});

describe("rooms (FR-2/3 / AC-2/AC-3)", () => {
  it("creates a room VACANT by default (AC-2)", async () => {
    const room = await prisma.room.create({
      data: {
        id: `${TEST_PREFIX}r1`,
        propertyId: PROP_A_ID,
        categoryId: CAT_DLX_ID,
        number: "T01",
      },
    });
    expect(room.status).toBe("VACANT");
    expect(room.isActive).toBe(true);
  });

  it("rejects a duplicate room number within the property (AC-3)", async () => {
    await expect(
      prisma.room.create({
        data: {
          id: `${TEST_PREFIX}dup`,
          propertyId: PROP_A_ID,
          categoryId: CAT_DLX_ID,
          number: "101", // R-101 already exists
        },
      }),
    ).rejects.toSatisfy(
      (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002",
    );
  });

  it("is enforced by the database, so concurrent creates cannot both win", async () => {
    const attempts = await Promise.allSettled(
      Array.from({ length: 3 }, (_, i) =>
        prisma.room.create({
          data: {
            id: `${TEST_PREFIX}race${i}`,
            propertyId: PROP_A_ID,
            categoryId: CAT_DLX_ID,
            number: "T99",
          },
        }),
      ),
    );
    expect(attempts.filter((a) => a.status === "fulfilled")).toHaveLength(1);
  });

  it("allows the same room number in a different property", async () => {
    const created = await prisma.room.create({
      data: {
        id: `${TEST_PREFIX}bnum`,
        propertyId: PROP_B_ID,
        categoryId: (
          await prisma.roomCategory.create({
            data: {
              id: `${TEST_PREFIX}bcat`,
              propertyId: PROP_B_ID,
              name: "B Deluxe",
              baseRatePaise: 400_000,
            },
          })
        ).id,
        number: "101",
      },
    });
    expect(created.number).toBe("101");
  });
});

describe("authorization (FR-10 / AC-12)", () => {
  it("denies Housekeeping room:manage — no create or delete (AC-12)", async () => {
    const hk = await claimsFor(USER_HOUSEKEEPING_ID);
    expect(hk.resolvedPermissions).not.toContain("room:manage");
    expect(() => authorize(hk, "room:manage", PROP_A_ID)).toThrow(ForbiddenError);
  });

  it("still lets Housekeeping see room status (they work the board)", async () => {
    const hk = await claimsFor(USER_HOUSEKEEPING_ID);
    expect(() => authorize(hk, "room:view-status", PROP_A_ID)).not.toThrow();
    expect(() => authorize(hk, "housekeeping:update", PROP_A_ID)).not.toThrow();
  });

  it("permits a Manager to manage rooms in their own property only", async () => {
    const manager = await claimsFor(USER_MANAGER_ID);
    expect(() => authorize(manager, "room:manage", PROP_A_ID)).not.toThrow();
    expect(() => authorize(manager, "room:manage", PROP_B_ID)).toThrow(OutOfScopeError);
  });

  it("denies Reception the maintenance:manage needed to block a room", async () => {
    const reception = await claimsFor(USER_RECEPTION_A_ID);
    expect(() => authorize(reception, "maintenance:manage", PROP_A_ID)).toThrow(ForbiddenError);
  });
});

describe("status transitions with real roles (AC-5/AC-7/AC-14)", () => {
  it("lets Reception drive reserve → check-in → check-out", async () => {
    const reception = await claimsFor(USER_RECEPTION_A_ID);
    const roles = reception.roleAssignments.map((r) => r.role);
    expect(canTransitionAsRole("VACANT", "RESERVED", roles)).toBe(true);
    expect(canTransitionAsRole("RESERVED", "OCCUPIED", roles)).toBe(true);
    expect(canTransitionAsRole("OCCUPIED", "HOUSEKEEPING", roles)).toBe(true);
  });

  it("lets Housekeeping mark a cleaned room vacant but not occupy one (AC-7)", async () => {
    const hk = await claimsFor(USER_HOUSEKEEPING_ID);
    const roles = hk.roleAssignments.map((r) => r.role);
    expect(canTransitionAsRole("HOUSEKEEPING", "VACANT", roles)).toBe(true);
    expect(canTransitionAsRole("VACANT", "OCCUPIED", roles)).toBe(false);
    expect(canTransitionAsRole("VACANT", "UNDER_MAINTENANCE", roles)).toBe(false);
  });

  it("lets Reception release a room on cancel / no-show (AC-14)", async () => {
    const reception = await claimsFor(USER_RECEPTION_A_ID);
    const roles = reception.roleAssignments.map((r) => r.role);
    // 03 AC-12 / AC-22 depend on both of these.
    expect(canTransitionAsRole("RESERVED", "VACANT", roles)).toBe(true);
    expect(canTransitionAsRole("OCCUPIED", "VACANT", roles)).toBe(true);
  });

  it("refuses UNDER_MAINTENANCE → OCCUPIED for every real role (AC-6)", async () => {
    for (const userId of [USER_ADMIN_ID, USER_MANAGER_ID, USER_RECEPTION_A_ID]) {
      const claims = await claimsFor(userId);
      const roles = claims.roleAssignments.map((r) => r.role);
      expect(canTransitionAsRole("UNDER_MAINTENANCE", "OCCUPIED", roles)).toBe(false);
    }
  });
});

describe("room blocks (FR-7 / AC-8/AC-9)", () => {
  it("excludes R-201 for 15–17 Jul when blocked 14–20 Jul, though it is VACANT (AC-8)", async () => {
    const room = await prisma.room.findUniqueOrThrow({ where: { id: ROOM_201_ID } });
    expect(room.status).toBe("VACANT"); // the point of AC-8

    await prisma.roomBlock.create({
      data: {
        id: `${TEST_PREFIX}blk`,
        propertyId: PROP_A_ID,
        roomId: ROOM_201_ID,
        startDate: d("2026-07-14"),
        endDate: d("2026-07-20"),
        reason: "Bathroom refit",
      },
    });

    const admin = await claimsFor(USER_ADMIN_ID);
    const blocks = await listRoomBlocks(admin, ROOM_201_ID);
    expect(
      isRoomBlockedDuring(blocks, { startDate: d("2026-07-15"), endDate: d("2026-07-17") }),
    ).toBe(true);
  });

  it("frees R-201 from 21 Jul onward (AC-9)", async () => {
    await prisma.roomBlock.create({
      data: {
        id: `${TEST_PREFIX}blk2`,
        propertyId: PROP_A_ID,
        roomId: ROOM_201_ID,
        startDate: d("2026-07-14"),
        endDate: d("2026-07-20"),
        reason: "Bathroom refit",
      },
    });

    const admin = await claimsFor(USER_ADMIN_ID);
    const blocks = await listRoomBlocks(admin, ROOM_201_ID);
    expect(
      isRoomBlockedDuring(blocks, { startDate: d("2026-07-21"), endDate: d("2026-07-23") }),
    ).toBe(false);
  });

  it("frees the room once the block row is removed (AC-9)", async () => {
    const block = await prisma.roomBlock.create({
      data: {
        id: `${TEST_PREFIX}blk3`,
        propertyId: PROP_A_ID,
        roomId: ROOM_201_ID,
        startDate: d("2026-07-14"),
        endDate: d("2026-07-20"),
        reason: "Bathroom refit",
      },
    });

    const admin = await claimsFor(USER_ADMIN_ID);
    expect(await listRoomBlocks(admin, ROOM_201_ID)).toHaveLength(1);

    await prisma.roomBlock.delete({ where: { id: block.id } });
    const after = await listRoomBlocks(admin, ROOM_201_ID);
    expect(
      isRoomBlockedDuring(after, { startDate: d("2026-07-15"), endDate: d("2026-07-17") }),
    ).toBe(false);
  });

  it("does not change the room's status — block and status are complementary", async () => {
    await prisma.roomBlock.create({
      data: {
        id: `${TEST_PREFIX}blk4`,
        propertyId: PROP_A_ID,
        roomId: ROOM_201_ID,
        startDate: d("2026-07-14"),
        endDate: d("2026-07-20"),
        reason: "Refit",
      },
    });
    const room = await prisma.room.findUniqueOrThrow({ where: { id: ROOM_201_ID } });
    expect(room.status).toBe("VACANT");
  });
});

describe("roomBoard (FR-9 / AC-10)", () => {
  it("returns every active room with its category and status", async () => {
    const admin = await claimsFor(USER_ADMIN_ID);
    const board = await roomBoard(admin, { propertyId: PROP_A_ID });

    expect(board.total).toBe(10);
    expect(board.counts.VACANT).toBe(6);
    expect(board.counts.OCCUPIED).toBe(3);
    expect(board.counts.UNDER_MAINTENANCE).toBe(1);

    const r101 = board.rooms.find((r) => r.id === ROOM_101_ID);
    expect(r101?.categoryName).toBe("Deluxe");
    expect(r101?.floorName).toBe("1");
  });

  it("filters by status", async () => {
    const admin = await claimsFor(USER_ADMIN_ID);
    const board = await roomBoard(admin, { propertyId: PROP_A_ID, status: "OCCUPIED" });
    expect(board.total).toBe(3);
    expect(board.rooms.every((r) => r.status === "OCCUPIED")).toBe(true);
  });

  it("filters by category", async () => {
    const admin = await claimsFor(USER_ADMIN_ID);
    const board = await roomBoard(admin, { propertyId: PROP_A_ID, categoryId: CAT_STE_ID });
    expect(board.total).toBe(5); // rooms 201-205
    expect(board.rooms.every((r) => r.categoryId === CAT_STE_ID)).toBe(true);
  });

  it("offers each caller only the transitions their role may drive (AC-7)", async () => {
    const hk = await claimsFor(USER_HOUSEKEEPING_ID);
    const board = await roomBoard(hk, { propertyId: PROP_A_ID });
    const vacant = board.rooms.find((r) => r.status === "VACANT");
    // Housekeeping cannot reserve, occupy, or take a room out of order.
    expect(vacant?.allowedTransitions).toEqual([]);

    const reception = await claimsFor(USER_RECEPTION_A_ID);
    const recBoard = await roomBoard(reception, { propertyId: PROP_A_ID });
    const recVacant = recBoard.rooms.find((r) => r.status === "VACANT");
    expect(recVacant?.allowedTransitions).toEqual(
      expect.arrayContaining(["RESERVED", "OCCUPIED"]),
    );
    expect(recVacant?.allowedTransitions).not.toContain("UNDER_MAINTENANCE");
  });

  it("excludes deactivated rooms (FR-8 / AC-13)", async () => {
    const admin = await claimsFor(USER_ADMIN_ID);
    await prisma.room.update({ where: { id: ROOM_202_ID }, data: { isActive: false } });
    try {
      const board = await roomBoard(admin, { propertyId: PROP_A_ID });
      expect(board.total).toBe(9);
      expect(board.rooms.map((r) => r.id)).not.toContain(ROOM_202_ID);
    } finally {
      await prisma.room.update({ where: { id: ROOM_202_ID }, data: { isActive: true } });
    }
  });

  it("refuses a board for an out-of-scope property (FR-10)", async () => {
    const manager = await claimsFor(USER_MANAGER_ID);
    await expect(roomBoard(manager, { propertyId: PROP_B_ID })).rejects.toThrow(OutOfScopeError);
  });

  it("flags a room blocked today", async () => {
    const today = new Date();
    const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    const end = new Date(start.getTime() + 3 * 24 * 60 * 60_000);

    await prisma.roomBlock.create({
      data: {
        id: `${TEST_PREFIX}today`,
        propertyId: PROP_A_ID,
        roomId: ROOM_201_ID,
        startDate: start,
        endDate: end,
        reason: "Live block",
      },
    });

    const admin = await claimsFor(USER_ADMIN_ID);
    const board = await roomBoard(admin, { propertyId: PROP_A_ID });
    expect(board.rooms.find((r) => r.id === ROOM_201_ID)?.blockedToday).toBe(true);
    expect(board.rooms.find((r) => r.id === ROOM_101_ID)?.blockedToday).toBe(false);
  });
});
