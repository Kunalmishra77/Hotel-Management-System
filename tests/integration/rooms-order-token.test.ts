/**
 * 19 addendum — per-room order token + QR (T-25, FR-19). Real DB, auth mocked at
 * the boundary. Uses throwaway rooms (never mutates seeded rooms' tokens).
 */
import { vi } from "vitest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
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

import { PROP_A_ID, USER_MANAGER_ID, USER_HOUSEKEEPING_ID } from "../../prisma/seed/fixtures";
import { assembleClaims } from "@/lib/auth/claims";
import { db } from "@/lib/db";
import { getRoomOrderQr } from "@/features/rooms/order-qr-actions";

const prisma = createPrismaClient();
const RUN = Date.now().toString(36);
const CAT_ID = `cat_ot_${RUN}`;
const ROOM_A = `room_ot_a_${RUN}`;
const ROOM_B = `room_ot_b_${RUN}`;

async function actAs(userId: string): Promise<SessionClaims> {
  const claims = await assembleClaims(prisma, userId);
  if (!claims) throw new Error(`no claims for ${userId}`);
  authMock.current = claims;
  return claims;
}

beforeAll(async () => {
  for (let i = 0; i < 3; i += 1) {
    try { await db.unscoped().$queryRawUnsafe("SELECT 1"); break; } catch (e) { if (i === 2) throw e; }
  }
  await prisma.roomCategory.create({ data: { id: CAT_ID, propertyId: PROP_A_ID, name: `OT-${RUN}`, baseRatePaise: 300_000, maxAdults: 2, maxChildren: 1, gstBps: 1200 } });
  await prisma.room.createMany({
    data: [
      { id: ROOM_A, propertyId: PROP_A_ID, categoryId: CAT_ID, number: `OTA-${RUN}` },
      { id: ROOM_B, propertyId: PROP_A_ID, categoryId: CAT_ID, number: `OTB-${RUN}` },
    ],
  });
});

beforeEach(() => { authMock.current = null; });

afterAll(async () => {
  await prisma.room.deleteMany({ where: { id: { in: [ROOM_A, ROOM_B] } } });
  await prisma.roomCategory.deleteMany({ where: { id: CAT_ID } });
  await prisma.$disconnect();
});

describe("getRoomOrderQr (T-25, FR-19)", () => {
  it("stamps a token + returns a QR/link, and is idempotent on re-call", async () => {
    await actAs(USER_MANAGER_ID);
    const first = await getRoomOrderQr({ roomId: ROOM_A });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.data.qrDataUrl.startsWith("data:image/png;base64,")).toBe(true);
    expect(first.data.url).toContain("/order/");

    const stamped = await prisma.room.findUniqueOrThrow({ where: { id: ROOM_A }, select: { orderToken: true } });
    expect(stamped.orderToken).not.toBeNull();
    expect(first.data.url).toContain(stamped.orderToken!);

    // Re-call returns the SAME token (no re-stamp).
    const second = await getRoomOrderQr({ roomId: ROOM_A });
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.data.url).toBe(first.data.url);
  });

  it("gives different rooms different tokens", async () => {
    await actAs(USER_MANAGER_ID);
    const a = await getRoomOrderQr({ roomId: ROOM_A });
    const b = await getRoomOrderQr({ roomId: ROOM_B });
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) expect(a.data.url).not.toBe(b.data.url);
  });

  it("denies a user without room:manage", async () => {
    await actAs(USER_HOUSEKEEPING_ID);
    const res = await getRoomOrderQr({ roomId: ROOM_B });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("FORBIDDEN");
  });
});
