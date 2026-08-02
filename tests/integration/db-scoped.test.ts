/**
 * Traceability: 00 T-8/T-9 — FR-8/9/10, AC-8/9/10.
 *
 * These assert the tenancy boundary is enforced by the CLIENT, not by callers
 * remembering a where-clause. Each test therefore issues a query that omits any
 * property filter and checks it was still confined.
 */
import { createPrismaClient } from "@/lib/db/client";
import { afterAll, beforeAll, afterEach, describe, expect, it } from "vitest";
import { ORG_ID, PROP_A_ID, PROP_B_ID } from "../../prisma/seed/fixtures";
import { assembleClaims } from "@/lib/auth/claims";
import { resetRoomsA } from "../../prisma/seed/01-property";
import { db, isPropertyScopedModel, PROPERTY_SCOPED_MODELS } from "@/lib/db";
import { OutOfScopeError } from "@/lib/errors";
import {
  USER_ACCOUNTS_ID,
  USER_ADMIN_ID,
  USER_RECEPTION_A_ID,
} from "../../prisma/seed/fixtures";

// Same client configuration as production (transaction budget, logging),
// so tests exercise the real behaviour rather than Prisma defaults.
const prisma = createPrismaClient();

/** Rooms in both properties, so a scope leak is observable. */
const ROOM_A = "test_room_scope_a";
const ROOM_B = "test_room_scope_b";
const CAT_A = "test_cat_scope_a";
const CAT_B = "test_cat_scope_b";

beforeAll(async () => {
  await prisma.roomCategory.upsert({
    where: { id: CAT_A },
    create: { id: CAT_A, propertyId: PROP_A_ID, name: "ScopeTest A", baseRatePaise: 400000 },
    update: {},
  });
  await prisma.roomCategory.upsert({
    where: { id: CAT_B },
    create: { id: CAT_B, propertyId: PROP_B_ID, name: "ScopeTest B", baseRatePaise: 400000 },
    update: {},
  });
  await prisma.room.upsert({
    where: { id: ROOM_A },
    create: { id: ROOM_A, propertyId: PROP_A_ID, categoryId: CAT_A, number: "S-A1" },
    update: {},
  });
  await prisma.room.upsert({
    where: { id: ROOM_B },
    create: { id: ROOM_B, propertyId: PROP_B_ID, categoryId: CAT_B, number: "S-B1" },
    update: {},
  });
});

afterEach(async () => {
  // Undo any status change a test made — including collateral damage. The
  // "unscoped-looking updateMany" test below deliberately omits a where clause,
  // so it rewrites EVERY room in PROP-A, not just this file's two. Restoring
  // only ROOM_A/ROOM_B once left 01's ROOMS-A fixture corrupted and broke its
  // occupancy assertions in a completely different file.
  await prisma.room.updateMany({
    where: { id: { in: [ROOM_A, ROOM_B] } },
    data: { status: "VACANT" },
  });
  await resetRoomsA(prisma);
});

afterAll(async () => {
  await prisma.room.deleteMany({ where: { id: { in: [ROOM_A, ROOM_B] } } });
  await prisma.roomCategory.deleteMany({ where: { id: { in: [CAT_A, CAT_B] } } });
  await prisma.$disconnect();
});

async function actorFor(userId: string) {
  const claims = await assembleClaims(prisma, userId);
  if (!claims) throw new Error(`no claims for ${userId}`);
  return claims;
}

describe("model classification", () => {
  it("classifies every model that carries a propertyId", () => {
    // Guards against a new model silently escaping tenancy.
    for (const m of PROPERTY_SCOPED_MODELS) expect(isPropertyScopedModel(m)).toBe(true);
    expect(isPropertyScopedModel("Organization")).toBe(false);
    expect(isPropertyScopedModel("Guest")).toBe(false); // org-level, not property
  });
});

describe("db.scoped — reads (AC-8 / FR-8)", () => {
  it("returns only PROP-A rows for U-REC-A, with NO where clause supplied", async () => {
    const scoped = db.scoped(await actorFor(USER_RECEPTION_A_ID));
    const rooms = await scoped.room.findMany();

    expect(rooms.length).toBeGreaterThan(0);
    for (const r of rooms) expect(r.propertyId).toBe(PROP_A_ID);
    expect(rooms.map((r) => r.id)).not.toContain(ROOM_B);
  });

  it("cannot reach a PROP-B row by id — findUnique is scoped too", async () => {
    const scoped = db.scoped(await actorFor(USER_RECEPTION_A_ID));
    expect(await scoped.room.findUnique({ where: { id: ROOM_B } })).toBeNull();
    // …while the in-scope row is reachable.
    expect(await scoped.room.findUnique({ where: { id: ROOM_A } })).not.toBeNull();
  });

  it("scopes counts and aggregates, not just findMany", async () => {
    const scoped = db.scoped(await actorFor(USER_RECEPTION_A_ID));
    const scopedCount = await scoped.room.count();
    const trueCount = await prisma.room.count();
    expect(scopedCount).toBeLessThan(trueCount);
    expect(scopedCount).toBe(await prisma.room.count({ where: { propertyId: PROP_A_ID } }));
  });

  it("gives U-ADMIN every property in the org (AC-10 / FR-10)", async () => {
    const scoped = db.scoped(await actorFor(USER_ADMIN_ID));
    const rooms = await scoped.room.findMany({ where: { id: { in: [ROOM_A, ROOM_B] } } });
    expect(rooms.map((r) => r.id).sort()).toEqual([ROOM_A, ROOM_B].sort());
  });

  it("gives U-ACC both assigned properties", async () => {
    const scoped = db.scoped(await actorFor(USER_ACCOUNTS_ID));
    const rooms = await scoped.room.findMany({ where: { id: { in: [ROOM_A, ROOM_B] } } });
    expect(rooms).toHaveLength(2);
  });

  it("leaves non-property models unfiltered", async () => {
    const scoped = db.scoped(await actorFor(USER_RECEPTION_A_ID));
    const org = await scoped.organization.findUnique({ where: { id: ORG_ID } });
    expect(org).not.toBeNull();
  });
});

describe("db.scoped — explicit out-of-scope targeting (AC-9 / FR-9)", () => {
  it("throws FORBIDDEN before reading when a query names PROP-B", async () => {
    const scoped = db.scoped(await actorFor(USER_RECEPTION_A_ID));
    await expect(scoped.room.findMany({ where: { propertyId: PROP_B_ID } })).rejects.toThrow(
      OutOfScopeError,
    );
  });

  it("throws when PROP-B appears inside an `in` list", async () => {
    const scoped = db.scoped(await actorFor(USER_RECEPTION_A_ID));
    await expect(
      scoped.room.findMany({ where: { propertyId: { in: [PROP_A_ID, PROP_B_ID] } } }),
    ).rejects.toThrow(OutOfScopeError);
  });

  it("throws when PROP-B is nested inside a boolean combinator", async () => {
    const scoped = db.scoped(await actorFor(USER_RECEPTION_A_ID));
    await expect(
      scoped.room.findMany({ where: { OR: [{ propertyId: PROP_B_ID }] } }),
    ).rejects.toThrow(OutOfScopeError);
  });

  it("refuses to CREATE a row in an out-of-scope property", async () => {
    const scoped = db.scoped(await actorFor(USER_RECEPTION_A_ID));
    await expect(
      scoped.room.create({
        data: { propertyId: PROP_B_ID, categoryId: CAT_B, number: "HACK-1" },
      }),
    ).rejects.toThrow(OutOfScopeError);

    expect(await prisma.room.findFirst({ where: { number: "HACK-1" } })).toBeNull();
  });
});

describe("db.scoped — writes (FR-8/9)", () => {
  it("cannot update a PROP-B row through an unscoped-looking updateMany", async () => {
    const scoped = db.scoped(await actorFor(USER_RECEPTION_A_ID));

    // No property filter given at all — the extension supplies the boundary.
    await scoped.room.updateMany({ data: { status: "HOUSEKEEPING" } });

    const b = await prisma.room.findUniqueOrThrow({ where: { id: ROOM_B } });
    expect(b.status).toBe("VACANT"); // untouched

    const a = await prisma.room.findUniqueOrThrow({ where: { id: ROOM_A } });
    expect(a.status).toBe("HOUSEKEEPING");
  });

  it("cannot update a PROP-B row by id", async () => {
    const scoped = db.scoped(await actorFor(USER_RECEPTION_A_ID));
    const { count } = await scoped.room.updateMany({
      where: { id: ROOM_B },
      data: { status: "OCCUPIED" },
    });
    expect(count).toBe(0);

    const b = await prisma.room.findUniqueOrThrow({ where: { id: ROOM_B } });
    expect(b.status).toBe("VACANT");
  });

  it("cannot delete out of scope", async () => {
    const scoped = db.scoped(await actorFor(USER_RECEPTION_A_ID));
    const { count } = await scoped.room.deleteMany({ where: { id: ROOM_B } });
    expect(count).toBe(0);
    expect(await prisma.room.findUnique({ where: { id: ROOM_B } })).not.toBeNull();
  });
});

describe("db.activeProperty (FR-27)", () => {
  it("returns the switched property for a multi-property user", async () => {
    const actor = await actorFor(USER_ACCOUNTS_ID);
    expect([PROP_A_ID, PROP_B_ID]).toContain(db.activeProperty(actor));
  });

  it("returns the only property for a single-property user", async () => {
    const actor = await actorFor(USER_RECEPTION_A_ID);
    expect(db.activeProperty(actor)).toBe(PROP_A_ID);
  });

  it("throws rather than returning a property the user cannot access", () => {
    expect(() =>
      db.activeProperty({
        orgId: ORG_ID,
        propertyScope: { kind: "PROPERTIES", propertyIds: [PROP_A_ID] },
        accessiblePropertyIds: [PROP_A_ID],
        activePropertyId: PROP_B_ID, // stale/tampered
      }),
    ).toThrow(OutOfScopeError);
  });

  it("throws when nothing is in scope", () => {
    expect(() =>
      db.activeProperty({
        orgId: ORG_ID,
        propertyScope: { kind: "PROPERTIES", propertyIds: [] },
        accessiblePropertyIds: [],
        activePropertyId: null,
      }),
    ).toThrow(OutOfScopeError);
  });
});
