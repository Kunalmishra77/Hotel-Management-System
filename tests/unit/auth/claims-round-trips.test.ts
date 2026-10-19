/**
 * Round-trip budget for session-claim assembly.
 *
 * Traceability: non-functional-requirements.md — "server confirm p95 < 800ms".
 *
 * WHY THIS TEST EXISTS. `assembleClaims` runs on EVERY request (FR-12 rebuilds
 * claims from live data rather than trusting the cookie), and the database is in
 * a different region from the app server. At a ~130ms round trip, each extra
 * SEQUENTIAL query inside this function costs every page in the product 130ms —
 * the queries themselves measure ~0.1ms, so latency here is round-trip COUNT,
 * not query cost.
 *
 * So this file does not assert "the right data comes back" (claims.test.ts and
 * the integration suite do that). It asserts the SHAPE of the I/O: how many
 * reads, and how many of them wait on each other. A refactor that adds a
 * sequential `await` here is a product-wide regression, and it should fail a
 * test rather than be discovered in production.
 */
import { describe, expect, it, vi } from "vitest";
import { assembleClaims } from "@/lib/auth/claims";

type Call = string;

/**
 * A fake `Db` that records every read and lets a test stall one of them.
 *
 * `gateOverridesOnProperty` is the concurrency probe: it makes the
 * PermissionOverride read refuse to settle until the Property read has been
 * ISSUED. If the implementation awaits them one after the other, the first
 * never completes and `assembleClaims` never returns — which is exactly the
 * regression we want to catch, surfaced as a timeout we control.
 */
function fakeDb(options: { gateOverridesOnProperty?: boolean } = {}) {
  const calls: Call[] = [];
  let propertyIssued!: () => void;
  const propertyWasIssued = new Promise<void>((resolve) => {
    propertyIssued = resolve;
  });

  const db = {
    user: {
      findFirst: vi.fn(async () => {
        calls.push("user.findFirst");
        return {
          id: "user-1",
          orgId: "org-1",
          name: "Asha Rao",
          email: "asha@example.com",
          roleAssignments: [{ role: "MANAGER", propertyIds: ["prop-1", "prop-2"] }],
        };
      }),
    },
    permissionOverride: {
      findMany: vi.fn(async () => {
        calls.push("permissionOverride.findMany");
        if (options.gateOverridesOnProperty) await propertyWasIssued;
        return [];
      }),
    },
    property: {
      findMany: vi.fn(async () => {
        calls.push("property.findMany");
        propertyIssued();
        return [{ id: "prop-1" }, { id: "prop-2" }];
      }),
    },
  };

  return { db: db as unknown as Parameters<typeof assembleClaims>[0], calls };
}

/** Fail fast with a readable message instead of hanging on the suite timeout. */
function withDeadline<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    work.finally(() => clearTimeout(timer)),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    }),
  ]);
}

describe("assembleClaims — round-trip budget", () => {
  it("issues exactly three reads: the user, the overrides, the properties", async () => {
    const { db, calls } = fakeDb();

    await assembleClaims(db, "user-1");

    // Three is the floor: the override and property reads both depend on data
    // the user row carries (its roles / its org), so one hop cannot be removed.
    // Any FOURTH read is a new 130ms tax on every page — justify it here or
    // fold it into one of the existing three.
    expect(calls).toHaveLength(3);
    expect(new Set(calls)).toEqual(
      new Set(["user.findFirst", "permissionOverride.findMany", "property.findMany"]),
    );
  });

  it("reads the overrides and the properties CONCURRENTLY, not one after the other", async () => {
    // Gated fake: the override read cannot settle until the property read has
    // been issued. Only a concurrent implementation gets past this.
    const { db } = fakeDb({ gateOverridesOnProperty: true });

    const claims = await withDeadline(
      assembleClaims(db, "user-1"),
      1_000,
      "assembleClaims issued the PermissionOverride and Property reads SEQUENTIALLY — " +
        "they do not depend on each other and must share one round trip (see file header)",
    );

    expect(claims?.accessiblePropertyIds).toEqual(["prop-1", "prop-2"]);
  });

  it("costs two sequential hops, so latency does not grow with role count", async () => {
    const { db, calls } = fakeDb();

    await assembleClaims(db, "user-1");

    // The user read must come first — everything after it is derived from it.
    expect(calls[0]).toBe("user.findFirst");
    // …and the remaining two are the single second hop, in either order.
    expect(calls.slice(1).sort()).toEqual(["permissionOverride.findMany", "property.findMany"]);
  });
});
