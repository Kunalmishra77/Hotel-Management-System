/**
 * Wave 3 — guest add-ons / upsells. Real DB, real folio charge, real GST.
 *
 * Two surfaces, two auth mechanisms mocked at the boundary:
 *  - the GUEST request action resolves its principal from `resolveGuestSession`;
 *  - the STAFF decide action + the reused `postFolioCharge` resolve from `requireUser`.
 * Covers request scoping/IDOR + status gating, and the money path: accept on an
 * in-house stay posts a correctly-split folio line (CGST+SGST) and links it back;
 * accept before check-in is refused; decline posts nothing; RBAC denies housekeeping.
 *
 * Folio rows are append-only (DB triggers block DELETE), so like billing.test.ts we
 * assert against fresh per-test data and don't clean money rows up.
 */
import { vi, afterAll, beforeEach, describe, expect, it } from "vitest";
import { createPrismaClient } from "@/lib/db/client";
import type { SessionClaims } from "@/lib/auth/claims";

vi.mock("server-only", () => ({}));

const authMock = vi.hoisted(() => ({ current: null as SessionClaims | null }));
vi.mock("@/lib/auth", () => ({
  requireUser: async () => {
    if (!authMock.current) throw new Error("no test user set");
    return authMock.current;
  },
}));

type GuestP = { sessionId: string; accountId: string; guestId: string; orgId: string };
const guestMock = vi.hoisted(() => ({ current: null as GuestP | null }));
vi.mock("@/lib/guest-auth", async (orig) => ({
  ...(await (orig() as Promise<Record<string, unknown>>)),
  resolveGuestSession: async () => guestMock.current,
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

import { PROP_A_ID, ORG_ID, USER_RECEPTION_A_ID, USER_HOUSEKEEPING_ID } from "../../prisma/seed/fixtures";
import { assembleClaims } from "@/lib/auth/claims";
import { requestAddOn } from "@/features/guest-account/upsell-actions";
import { decideAddOnRequest } from "@/features/add-ons/actions";

const prisma = createPrismaClient();
const NONCE = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const EXTRA_BED = "addon_a_extrabed"; // seeded: EXTRA_BED, ₹800, 12%
let seq = 0;

async function actAs(userId: string): Promise<SessionClaims> {
  const claims = await assembleClaims(prisma, userId);
  if (!claims) throw new Error(`no claims for ${userId}`);
  authMock.current = claims;
  return claims;
}

async function makeGuest(tag: string): Promise<string> {
  const g = await prisma.guest.create({
    data: { orgId: ORG_ID, fullName: `AddOn ${tag}`, mobile: "enc", mobileHash: `ah_${tag}_${NONCE}` },
    select: { id: true },
  });
  return g.id;
}

async function makeReservation(guestId: string, status: string): Promise<string> {
  seq += 1;
  const r = await prisma.reservation.create({
    data: {
      propertyId: PROP_A_ID, code: `AO-${NONCE}-${seq}`, guestId, status: status as never, source: "WEBSITE",
      checkInDate: new Date("2027-04-10"), checkOutDate: new Date("2027-04-12"),
      nights: 2, adults: 2, ratePaise: 500000, taxPaise: 60000, advancePaise: 0,
    },
    select: { id: true },
  });
  return r.id;
}

/** A REQUESTED add-on row placed directly (bypassing the guest session) for staff tests. */
async function placeRequest(reservationId: string, guestId: string): Promise<string> {
  const row = await prisma.addOnRequest.create({
    data: {
      orgId: ORG_ID, propertyId: PROP_A_ID, reservationId, guestId, addOnId: EXTRA_BED,
      nameSnapshot: "Extra bed", unitPaise: 80_000, quantity: 1, chargeType: "EXTRA_BED",
    },
    select: { id: true },
  });
  return row.id;
}

beforeEach(() => { authMock.current = null; guestMock.current = null; });
afterAll(async () => { await prisma.$disconnect(); });

describe("requestAddOn (guest)", () => {
  it("places a request on the guest's own confirmed booking, snapshotting price", async () => {
    const guestId = await makeGuest("own");
    const resId = await makeReservation(guestId, "CONFIRMED");
    guestMock.current = { sessionId: "s", accountId: "a", guestId, orgId: ORG_ID };

    const res = await requestAddOn({ reservationId: resId, addOnId: EXTRA_BED, quantity: 2 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const row = await prisma.addOnRequest.findUniqueOrThrow({ where: { id: res.data.requestId } });
    expect(row.status).toBe("REQUESTED");
    expect(row.unitPaise).toBe(80_000);
    expect(row.quantity).toBe(2);
    expect(row.guestId).toBe(guestId);
    expect(await prisma.domainEvent.findFirst({ where: { type: "AddOnRequested", aggregateId: row.id } })).not.toBeNull();
  });

  it("refuses another guest's booking (IDOR → NOT_FOUND)", async () => {
    const owner = await makeGuest("a");
    const other = await makeGuest("b");
    const resId = await makeReservation(owner, "CONFIRMED");
    guestMock.current = { sessionId: "s", accountId: "a", guestId: other, orgId: ORG_ID };

    const res = await requestAddOn({ reservationId: resId, addOnId: EXTRA_BED });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("NOT_FOUND");
  });

  it("refuses a checked-out booking (status gate)", async () => {
    const guestId = await makeGuest("out");
    const resId = await makeReservation(guestId, "CHECKED_OUT");
    guestMock.current = { sessionId: "s", accountId: "a", guestId, orgId: ORG_ID };

    const res = await requestAddOn({ reservationId: resId, addOnId: EXTRA_BED });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("ILLEGAL_TRANSITION");
  });
});

describe("decideAddOnRequest (staff)", () => {
  it("ACCEPT on an in-house stay posts a CGST+SGST folio line and links it", async () => {
    const guestId = await makeGuest("ih");
    const resId = await makeReservation(guestId, "IN_HOUSE");
    const reqId = await placeRequest(resId, guestId);

    await actAs(USER_RECEPTION_A_ID);
    const res = await decideAddOnRequest(reqId, "ACCEPT");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.status).toBe("ACCEPTED");

    const row = await prisma.addOnRequest.findUniqueOrThrow({ where: { id: reqId } });
    expect(row.status).toBe("ACCEPTED");
    expect(row.folioLineId).toBeTruthy();

    const line = await prisma.folioLine.findUniqueOrThrow({ where: { id: row.folioLineId! } });
    expect(line.type).toBe("EXTRA_BED");
    expect(Number(line.amountPaise)).toBe(80_000);
    expect(line.cgstPaise).toBe(4_800); // 12% split
    expect(line.sgstPaise).toBe(4_800);
    expect(line.igstPaise).toBe(0);
    expect(await prisma.domainEvent.findFirst({ where: { type: "AddOnAccepted", aggregateId: reqId } })).not.toBeNull();

    // Re-accepting a settled request is refused (forward-only) — no second charge.
    const again = await decideAddOnRequest(reqId, "ACCEPT");
    expect(again.ok).toBe(false);
    const lines = await prisma.folioLine.count({ where: { id: row.folioLineId! } });
    expect(lines).toBe(1);
  });

  it("ACCEPT before check-in (CONFIRMED) is refused and posts nothing", async () => {
    const guestId = await makeGuest("early");
    const resId = await makeReservation(guestId, "CONFIRMED");
    const reqId = await placeRequest(resId, guestId);

    await actAs(USER_RECEPTION_A_ID);
    const res = await decideAddOnRequest(reqId, "ACCEPT");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("FOLIO_TARGET_INVALID");

    const row = await prisma.addOnRequest.findUniqueOrThrow({ where: { id: reqId } });
    expect(row.status).toBe("REQUESTED"); // still open
    expect(row.folioLineId).toBeNull();
  });

  it("DECLINE marks the request declined with no folio line", async () => {
    const guestId = await makeGuest("dec");
    const resId = await makeReservation(guestId, "IN_HOUSE");
    const reqId = await placeRequest(resId, guestId);

    await actAs(USER_RECEPTION_A_ID);
    const res = await decideAddOnRequest(reqId, "DECLINE");
    expect(res.ok).toBe(true);

    const row = await prisma.addOnRequest.findUniqueOrThrow({ where: { id: reqId } });
    expect(row.status).toBe("DECLINED");
    expect(row.folioLineId).toBeNull();
  });

  it("denies a housekeeping user (no folio:charge)", async () => {
    const guestId = await makeGuest("hk");
    const resId = await makeReservation(guestId, "IN_HOUSE");
    const reqId = await placeRequest(resId, guestId);

    await actAs(USER_HOUSEKEEPING_ID);
    const res = await decideAddOnRequest(reqId, "ACCEPT");
    expect(res.ok).toBe(false);

    const row = await prisma.addOnRequest.findUniqueOrThrow({ where: { id: reqId } });
    expect(row.status).toBe("REQUESTED"); // untouched
  });
});
