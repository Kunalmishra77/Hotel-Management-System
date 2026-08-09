/**
 * 27 owner-portal — integration. Auth mocked at the boundary; everything else
 * real against the test DB. Grows per phase (financials now; docs/schedule/payout
 * added as those phases land).
 */
import { vi } from "vitest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient } from "@/lib/db/client";
import type { SessionClaims } from "@/lib/auth/claims";

const authMock = vi.hoisted(() => ({ current: null as SessionClaims | null }));
vi.mock("@/lib/auth", () => ({
  requireUser: async () => {
    if (!authMock.current) throw new Error("no test user set");
    return authMock.current;
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

import {
  PROP_A_ID,
  PROP_B_ID,
  USER_OWNER_A_ID,
  USER_RECEPTION_A_ID,
} from "../../prisma/seed/fixtures";
import { assembleClaims } from "@/lib/auth/claims";
import { ownerFinancials } from "@/features/owner-portal/queries";

const prisma = createPrismaClient();
const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

async function actAs(userId: string): Promise<SessionClaims> {
  const claims = await assembleClaims(prisma, userId);
  if (!claims) throw new Error(`no claims for ${userId}`);
  authMock.current = claims;
  return claims;
}

beforeAll(async () => {
  await prisma.$queryRawUnsafe("SELECT 1");
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe("Owner financials (AC-4) — reused numbers under owner permission", () => {
  it("an OWNER (no report:view-financial) can read their property's financials", async () => {
    const user = await actAs(USER_OWNER_A_ID);
    // Proves the gotcha: owner does NOT hold report:view-financial…
    expect(user.resolvedPermissions).not.toContain("report:view-financial");
    // …yet the owner query works via owner:view-financials.
    expect(user.resolvedPermissions).toContain("owner:view-financials");

    const fin = await ownerFinancials(user, { propertyId: PROP_A_ID, from: d("2026-01-01"), to: d("2026-12-31") });
    expect(fin.breakdown).toHaveProperty("revenuePaise");
    expect(fin.breakdown).toHaveProperty("profitPaise");
    expect(fin.metrics).toHaveProperty("occupancyBps");
    expect(Array.isArray(fin.trend)).toBe(true);
  });

  it("denies a property the owner does not own (AC-2)", async () => {
    const user = await actAs(USER_OWNER_A_ID); // owns PROP-A only
    await expect(
      ownerFinancials(user, { propertyId: PROP_B_ID, from: d("2026-01-01"), to: d("2026-12-31") }),
    ).rejects.toMatchObject({ code: "OUT_OF_SCOPE" });
  });

  it("denies a non-owner staff role (AC-18)", async () => {
    const user = await actAs(USER_RECEPTION_A_ID);
    await expect(
      ownerFinancials(user, { propertyId: PROP_A_ID, from: d("2026-01-01"), to: d("2026-12-31") }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
