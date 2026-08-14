/**
 * Phase 7 — Lost & Found actions.
 *
 * Housekeeping logs and resolves a found item, scoped to its active property and
 * gated by `housekeeping:update`; a non-housekeeping role is refused. A resolved
 * item can't be resolved again.
 */
import { vi, afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPrismaClient } from "@/lib/db/client";
import type { SessionClaims } from "@/lib/auth/claims";

const authMock = vi.hoisted(() => ({ current: null as SessionClaims | null }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => { if (!authMock.current) throw new Error("no user"); return authMock.current; } }));

import { PROP_A_ID, USER_HOUSEKEEPING_ID, USER_ACCOUNTS_ID } from "../../prisma/seed/fixtures";
import { assembleClaims } from "@/lib/auth/claims";
import { logLostItem, resolveLostItem } from "@/features/lost-found/actions";

const prisma = createPrismaClient();
const created: string[] = [];

async function actAs(userId: string) {
  const c = await assembleClaims(prisma, userId);
  if (!c) throw new Error("no claims");
  authMock.current = c;
}
function track(r: { ok: boolean; data?: { id: string } }) { if (r.ok && r.data) created.push(r.data.id); }

beforeEach(() => { authMock.current = null; });
afterEach(async () => { if (created.length) { await prisma.lostAndFoundItem.deleteMany({ where: { id: { in: created } } }); created.length = 0; } });
afterAll(async () => { await prisma.$disconnect(); });

describe("logLostItem", () => {
  it("logs a STORED item for the active property (housekeeping)", async () => {
    await actAs(USER_HOUSEKEEPING_ID);
    const res = await logLostItem({ description: "Black charger", foundOn: "2026-08-14" });
    track(res);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const row = await prisma.lostAndFoundItem.findUniqueOrThrow({ where: { id: res.data.id } });
    expect(row.status).toBe("STORED");
    expect(row.propertyId).toBe(PROP_A_ID);
    expect(await prisma.auditLog.findFirst({ where: { action: "lostfound:log", entityId: res.data.id } })).not.toBeNull();
  });

  it("refuses a role without housekeeping:update (FORBIDDEN)", async () => {
    await actAs(USER_ACCOUNTS_ID);
    const res = await logLostItem({ description: "Umbrella", foundOn: "2026-08-14" });
    track(res);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("FORBIDDEN");
  });
});

describe("resolveLostItem", () => {
  it("marks a stored item claimed, then refuses a second resolve", async () => {
    await actAs(USER_HOUSEKEEPING_ID);
    const made = await logLostItem({ description: "Sunglasses", foundOn: "2026-08-14" });
    track(made);
    if (!made.ok) throw new Error("setup");

    const claim = await resolveLostItem({ id: made.data.id, status: "CLAIMED", claimantName: "R. Kumar" });
    expect(claim.ok).toBe(true);
    const row = await prisma.lostAndFoundItem.findUniqueOrThrow({ where: { id: made.data.id } });
    expect(row.status).toBe("CLAIMED");
    expect(row.claimantName).toBe("R. Kumar");
    expect(row.resolvedOn).not.toBeNull();

    const again = await resolveLostItem({ id: made.data.id, status: "DISPOSED" });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.code).toBe("ILLEGAL_TRANSITION");
  });
});
