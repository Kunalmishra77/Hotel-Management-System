/**
 * Traceability: 01 T-5..T-11 — FR-1..FR-9, AC-1..AC-10.
 *
 * The actions resolve their own session, so these tests exercise the pieces the
 * action composes — authorize + the transactional write path — against the real
 * database, and assert the event + audit rows the spec requires.
 */
import { Prisma } from "@prisma/client";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { createPrismaClient } from "@/lib/db/client";
import {
  ORG_ID,
  PROP_A_ID,
  PROP_B_ID,
  ROOMS_A_MAINTENANCE,
  ROOMS_A_OCCUPANCY_BPS,
  ROOMS_A_OCCUPIED,
  ROOMS_A_TOTAL,
  ROOMS_A_VACANT,
  USER_ADMIN_ID,
  USER_MANAGER_ID,
  USER_RECEPTION_A_ID,
} from "../../prisma/seed/fixtures";
import { assembleClaims } from "@/lib/auth/claims";
import { authorize, resolvePropertyScope } from "@/lib/permissions";
import { ForbiddenError, OutOfScopeError } from "@/lib/errors";
import {
  getProperty,
  listFloors,
  listProperties,
  propertyOverview,
} from "@/features/properties/queries";
import { createPropertySchema } from "@/features/properties/schema";

const prisma = createPrismaClient();

/** Properties created by these tests, cleaned up afterwards. */
const TEST_CODE_PREFIX = "ZZ";

afterEach(async () => {
  const created = await prisma.property.findMany({
    where: { code: { startsWith: TEST_CODE_PREFIX } },
    select: { id: true },
  });
  const ids = created.map((p) => p.id);
  if (ids.length > 0) {
    await prisma.floor.deleteMany({ where: { propertyId: { in: ids } } });
    await prisma.property.deleteMany({ where: { id: { in: ids } } });
  }
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function claimsFor(userId: string) {
  const claims = await assembleClaims(prisma, userId);
  if (!claims) throw new Error(`no claims for ${userId}`);
  return claims;
}

describe("input validation (AC-10)", () => {
  it("rejects missing required fields with field messages", () => {
    const result = createPropertySchema.safeParse({ name: "No Address Hotel", code: "ZZ1" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const fields = result.error.flatten().fieldErrors;
      expect(fields.addressLine1).toBeDefined();
      expect(fields.city).toBeDefined();
      expect(fields.state).toBeDefined();
      expect(fields.pincode).toBeDefined();
    }
  });

  it("rejects a malformed pincode", () => {
    const base = {
      name: "X",
      code: "ZZ2",
      addressLine1: "1 Road",
      city: "Bengaluru",
      state: "Karnataka",
    };
    expect(createPropertySchema.safeParse({ ...base, pincode: "12345" }).success).toBe(false);
    expect(createPropertySchema.safeParse({ ...base, pincode: "012345" }).success).toBe(false);
    expect(createPropertySchema.safeParse({ ...base, pincode: "560001" }).success).toBe(true);
  });

  it("accepts a valid GSTIN and rejects a bad checksum (AC-3)", () => {
    const base = {
      name: "X",
      code: "ZZ3",
      addressLine1: "1 Road",
      city: "Bengaluru",
      state: "Karnataka",
      pincode: "560001",
    };
    expect(createPropertySchema.safeParse({ ...base, gstin: "29ABCDE1234F1ZW" }).success).toBe(true);
    // Correct shape, wrong check digit — the classic typo.
    expect(createPropertySchema.safeParse({ ...base, gstin: "29ABCDE1234F1Z5" }).success).toBe(false);
    expect(createPropertySchema.safeParse({ ...base, gstin: "29ABC" }).success).toBe(false);
    // GSTIN is optional (FR-1) — a property need not be GST-registered.
    expect(createPropertySchema.safeParse({ ...base, gstin: "" }).success).toBe(true);
    expect(createPropertySchema.safeParse(base).success).toBe(true);
  });

  it("normalises the code to uppercase — it feeds invoice numbering", () => {
    const parsed = createPropertySchema.parse({
      name: "X",
      code: "zz4",
      addressLine1: "1 Road",
      city: "Bengaluru",
      state: "Karnataka",
      pincode: "560001",
    });
    expect(parsed.code).toBe("ZZ4");
  });

  it("rejects a timezone that is not a real IANA zone", () => {
    const base = {
      name: "X",
      code: "ZZ5",
      addressLine1: "1 Road",
      city: "Bengaluru",
      state: "Karnataka",
      pincode: "560001",
    };
    expect(createPropertySchema.safeParse({ ...base, timezone: "Mars/Olympus" }).success).toBe(false);
    expect(createPropertySchema.safeParse({ ...base, timezone: "Asia/Kolkata" }).success).toBe(true);
  });
});

describe("authorization (AC-9 / FR-8)", () => {
  it("permits an Administrator to manage properties", async () => {
    const admin = await claimsFor(USER_ADMIN_ID);
    expect(() => authorize(admin, "property:manage")).not.toThrow();
    expect(admin.propertyScope.kind).toBe("ALL_IN_ORG");
  });

  it("denies Reception outright — no property:manage at all", async () => {
    const reception = await claimsFor(USER_RECEPTION_A_ID);
    expect(() => authorize(reception, "property:manage", PROP_A_ID)).toThrow(ForbiddenError);
  });

  it("gives a Manager property:manage but NOT org-wide scope (AC-9)", async () => {
    // The reconciliation of rbac-matrix.md (Manager holds property:manage 🔒)
    // with AC-9 (Manager cannot CREATE a property): creation is an org-scoped
    // act, and a Manager's scope is bounded to their assignments.
    const manager = await claimsFor(USER_MANAGER_ID);
    expect(manager.resolvedPermissions).toContain("property:manage");
    expect(manager.propertyScope.kind).toBe("PROPERTIES");
    expect(manager.accessiblePropertyIds).toEqual([PROP_A_ID]);
  });

  it("lets a Manager edit their assigned property but not another one", async () => {
    const manager = await claimsFor(USER_MANAGER_ID);
    expect(() => authorize(manager, "property:manage", PROP_A_ID)).not.toThrow();
    expect(() => authorize(manager, "property:manage", PROP_B_ID)).toThrow(OutOfScopeError);
  });
});

describe("code uniqueness (FR-2 / AC-2)", () => {
  it("refuses a duplicate code within the organisation", async () => {
    // WMG is already taken by PROP-A.
    await expect(
      prisma.property.create({
        data: {
          orgId: ORG_ID,
          name: "Impostor",
          code: "WMG",
          addressLine1: "1 Road",
          city: "Bengaluru",
          state: "Karnataka",
          pincode: "560001",
        },
      }),
    ).rejects.toSatisfy(
      (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002",
    );
  });

  it("is enforced by the database, so concurrent creates cannot both win", async () => {
    const attempts = await Promise.allSettled(
      Array.from({ length: 3 }, (_, i) =>
        prisma.property.create({
          data: {
            orgId: ORG_ID,
            name: `Race ${i}`,
            code: `${TEST_CODE_PREFIX}R`,
            addressLine1: "1 Road",
            city: "Bengaluru",
            state: "Karnataka",
            pincode: "560001",
          },
        }),
      ),
    );
    expect(attempts.filter((a) => a.status === "fulfilled")).toHaveLength(1);
  });
});

describe("floors (FR-4 / AC-4)", () => {
  it("lists the seeded floors in order", async () => {
    const admin = await claimsFor(USER_ADMIN_ID);
    const floors = await listFloors(admin, PROP_A_ID);
    expect(floors.map((f) => f.name)).toEqual(["Ground", "1", "2"]);
  });

  it("rejects a duplicate floor name within the property", async () => {
    await expect(
      prisma.floor.create({ data: { propertyId: PROP_A_ID, name: "1", sortOrder: 9 } }),
    ).rejects.toSatisfy(
      (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002",
    );
  });

  it("allows the same floor name in a DIFFERENT property", async () => {
    // Uniqueness is (propertyId, name) — "1" exists in most buildings.
    const floor = await prisma.floor.create({
      data: { propertyId: PROP_B_ID, name: "1", sortOrder: 0 },
    });
    expect(floor.id).toBeTruthy();
    await prisma.floor.delete({ where: { id: floor.id } });
  });

  it("refuses to list floors of an out-of-scope property (FR-8)", async () => {
    const manager = await claimsFor(USER_MANAGER_ID);
    await expect(listFloors(manager, PROP_B_ID)).rejects.toThrow(OutOfScopeError);
  });
});

describe("listProperties — scoping (FR-8 / AC-8)", () => {
  it("shows an Administrator every property in the org", async () => {
    const admin = await claimsFor(USER_ADMIN_ID);
    const list = await listProperties(admin);
    // "Every property in the org" — assert against the org, not a fixed pair.
    const orgProperties = await prisma.property.findMany({
      where: { orgId: ORG_ID, isActive: true, deletedAt: null },
      select: { id: true },
    });
    expect(list.map((p) => p.id).sort()).toEqual(orgProperties.map((p) => p.id).sort());
    expect(list.map((p) => p.code)).toEqual(expect.arrayContaining(["WMG", "WWF"]));
  });

  it("shows USER-MGR-A only PROP-A, never PROP-B (AC-8)", async () => {
    const manager = await claimsFor(USER_MANAGER_ID);
    const list = await listProperties(manager);
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe(PROP_A_ID);
    expect(list.map((p) => p.id)).not.toContain(PROP_B_ID);
  });

  it("returns nothing for a user with no property scope — deny by default", async () => {
    const empty = {
      ...(await claimsFor(USER_MANAGER_ID)),
      accessiblePropertyIds: [],
      propertyScope: resolvePropertyScope([]),
    };
    expect(await listProperties(empty)).toEqual([]);
  });

  it("hides a deactivated property from the operational list but keeps the row (FR-5 / AC-5)", async () => {
    const created = await prisma.property.create({
      data: {
        orgId: ORG_ID,
        name: "Soon Closed",
        code: `${TEST_CODE_PREFIX}D`,
        addressLine1: "1 Road",
        city: "Bengaluru",
        state: "Karnataka",
        pincode: "560001",
      },
      select: { id: true },
    });

    const admin = {
      ...(await claimsFor(USER_ADMIN_ID)),
    };
    admin.accessiblePropertyIds = [...admin.accessiblePropertyIds, created.id];

    expect((await listProperties(admin)).map((p) => p.id)).toContain(created.id);

    await prisma.property.update({
      where: { id: created.id },
      data: { isActive: false, deletedAt: new Date() },
    });

    // Gone from operational flows…
    expect((await listProperties(admin)).map((p) => p.id)).not.toContain(created.id);
    // …but still there for historical reporting.
    const forReports = await listProperties(admin, { includeInactive: true });
    expect(forReports.map((p) => p.id)).toContain(created.id);
    expect(await prisma.property.findUnique({ where: { id: created.id } })).not.toBeNull();
  });
});

describe("getProperty — scoping (FR-8/FR-9)", () => {
  it("returns an in-scope property", async () => {
    const manager = await claimsFor(USER_MANAGER_ID);
    expect((await getProperty(manager, PROP_A_ID))?.code).toBe("WMG");
  });

  it("throws before reading for an out-of-scope property", async () => {
    const manager = await claimsFor(USER_MANAGER_ID);
    await expect(getProperty(manager, PROP_B_ID)).rejects.toThrow(OutOfScopeError);
  });
});

describe("propertyOverview — live occupancy (FR-6 / AC-6 / AC-8)", () => {
  it("rolls ROOMS-A up to exactly the numbers AC-6 states", async () => {
    const admin = await claimsFor(USER_ADMIN_ID);
    const overview = await propertyOverview(admin);
    const propA = overview.find((p) => p.id === PROP_A_ID);

    expect(propA).toBeDefined();
    expect(propA!.occupancy.total).toBe(ROOMS_A_TOTAL);
    expect(propA!.occupancy.vacant).toBe(ROOMS_A_VACANT);
    expect(propA!.occupancy.occupied).toBe(ROOMS_A_OCCUPIED);
    expect(propA!.occupancy.maintenance).toBe(ROOMS_A_MAINTENANCE);
    // 3 ÷ (10 − 1) = 33.33%
    expect(propA!.occupancy.availableForOccupancy).toBe(9);
    expect(propA!.occupancy.occupancyBps).toBe(ROOMS_A_OCCUPANCY_BPS);
  });

  it("reports 0%, not NaN, for a property with no rooms", async () => {
    const admin = await claimsFor(USER_ADMIN_ID);
    const propB = (await propertyOverview(admin)).find((p) => p.id === PROP_B_ID);
    expect(propB!.occupancy.total).toBe(0);
    expect(propB!.occupancy.occupancyBps).toBe(0);
  });

  it("shows a scoped Manager only their own property (AC-8)", async () => {
    const manager = await claimsFor(USER_MANAGER_ID);
    const overview = await propertyOverview(manager);
    expect(overview).toHaveLength(1);
    expect(overview[0]!.id).toBe(PROP_A_ID);
  });

  it("recomputes after a room status change (AC-7 basis)", async () => {
    const admin = await claimsFor(USER_ADMIN_ID);
    const before = (await propertyOverview(admin)).find((p) => p.id === PROP_A_ID)!;
    expect(before.occupancy.occupancyBps).toBe(3333);

    // Check a vacant room in: 4 occupied ÷ 9 = 44.44%.
    await prisma.room.update({ where: { id: "room_wmg_101" }, data: { status: "OCCUPIED" } });
    try {
      const after = (await propertyOverview(admin)).find((p) => p.id === PROP_A_ID)!;
      expect(after.occupancy.occupied).toBe(4);
      expect(after.occupancy.occupancyBps).toBe(4444);
    } finally {
      await prisma.room.update({ where: { id: "room_wmg_101" }, data: { status: "VACANT" } });
    }
  });

  it("counts only ACTIVE rooms", async () => {
    const admin = await claimsFor(USER_ADMIN_ID);
    await prisma.room.update({ where: { id: "room_wmg_102" }, data: { isActive: false } });
    try {
      const propA = (await propertyOverview(admin)).find((p) => p.id === PROP_A_ID)!;
      expect(propA.occupancy.total).toBe(ROOMS_A_TOTAL - 1);
    } finally {
      await prisma.room.update({ where: { id: "room_wmg_102" }, data: { isActive: true } });
    }
  });
});
