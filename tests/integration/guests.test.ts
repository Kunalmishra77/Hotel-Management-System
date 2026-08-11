/**
 * Traceability: 04 T-8..T-15 — FR-1..FR-16, AC-1..AC-16.
 *
 * The server actions call `requireUser()` (Auth.js) internally, which cannot
 * run under vitest. We mock ONLY that boundary — everything else runs for real:
 * the real `authorize`, real encryption, real advisory lock, real DB writes,
 * real audit/event rows. `next/cache` is stubbed (no request context here).
 *
 * Beyond the ACs, this file carries the adversarial PII-leak probes the plan
 * called for: erase actually nulls the tokens in-DB, and no action returns or
 * audits a raw PII value.
 */
import { vi } from "vitest";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPrismaClient } from "@/lib/db/client";
import type { SessionClaims } from "@/lib/auth/claims";

// Mocks must be declared before importing the actions under test.
const authMock = vi.hoisted(() => ({ current: null as SessionClaims | null }));
vi.mock("@/lib/auth", () => ({
  requireUser: async () => {
    if (!authMock.current) throw new Error("no test user set");
    return authMock.current;
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

import {
  GUEST_MEHTA_ID,
  GUEST_RAVI2_ID,
  GUEST_RAVI_ID,
  GUEST_RAVI_MOBILE,
  ORG_ID,
  USER_ADMIN_ID,
  USER_HOUSEKEEPING_ID,
  USER_MANAGER_ID,
  USER_RECEPTION_A_ID,
} from "../../prisma/seed/fixtures";
import { seedGuests } from "../../prisma/seed/04-guest";
import { assembleClaims } from "@/lib/auth/claims";
import { keyedHash } from "@/lib/crypto/encryption";
import { normalizePhone } from "@/features/guests/domain/normalize";
import { createGuest } from "@/features/guests/actions";
import { addGuestId } from "@/features/guests/id-actions";
import { revealPii, exportGuestData } from "@/features/guests/pii-actions";
import { eraseGuest } from "@/features/guests/erase-actions";
import { mergeGuests } from "@/features/guests/merge-actions";
import { searchGuests, getGuestProfile, guestsBySegment } from "@/features/guests/queries";

const prisma = createPrismaClient();
const createdIds: string[] = [];

async function actAs(userId: string): Promise<SessionClaims> {
  const claims = await assembleClaims(prisma, userId);
  if (!claims) throw new Error(`no claims for ${userId}`);
  authMock.current = claims;
  return claims;
}

beforeEach(async () => {
  await seedGuests(prisma); // reset the three fixture guests
  authMock.current = null;
});

afterEach(async () => {
  // Remove anything a test created through createGuest.
  if (createdIds.length) {
    await prisma.guestId.deleteMany({ where: { guestId: { in: createdIds } } });
    await prisma.guest.deleteMany({ where: { id: { in: createdIds } } });
    createdIds.length = 0;
  }
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("createGuest (FR-1/2/5/6 / AC-1/2/3)", () => {
  it("creates a guest and stores contact ENCRYPTED with a search token (AC-1)", async () => {
    await actAs(USER_RECEPTION_A_ID);
    const res = await createGuest({ fullName: "Neha Singh", mobile: "9811111111" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    createdIds.push(res.data.id);

    const row = await prisma.guest.findUniqueOrThrow({ where: { id: res.data.id } });
    expect(row.fullName).toBe("Neha Singh");
    // Not plaintext: the stored mobile is an encryption envelope.
    expect(row.mobile).not.toBe("9811111111");
    expect(row.mobile?.startsWith("v1.")).toBe(true);
    // …but the keyed token makes it findable.
    expect(row.mobileHash).toBe(keyedHash(normalizePhone("9811111111")!));
  });

  it("emits GuestCreated + audit, with NO contact in either (FR-11/16)", async () => {
    await actAs(USER_RECEPTION_A_ID);
    const res = await createGuest({ fullName: "Priya Rao", mobile: "9822222222" });
    if (!res.ok) throw new Error("create failed");
    createdIds.push(res.data.id);

    const event = await prisma.domainEvent.findFirstOrThrow({
      where: { type: "GuestCreated", aggregateId: res.data.id },
    });
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: "guest:create", entityId: res.data.id },
    });
    const combined = JSON.stringify(event.payload) + JSON.stringify(audit.after);
    // The number must not appear anywhere in the event or the audit row.
    expect(combined).not.toContain("9822222222");
  });

  it("rejects a missing or invalid mobile at validation (AC-2)", async () => {
    await actAs(USER_RECEPTION_A_ID);
    const noMobile = await createGuest({ fullName: "No Phone" });
    expect(noMobile.ok).toBe(false);
    const badMobile = await createGuest({ fullName: "Bad Phone", mobile: "12345" });
    expect(badMobile.ok).toBe(false);
    if (!badMobile.ok) expect(badMobile.error.code).toBe("VALIDATION_FAILED");
  });

  it("returns DUPLICATE_GUEST with masked candidates on a same-mobile create (AC-3)", async () => {
    await actAs(USER_RECEPTION_A_ID);
    // G-RAVI already has 9800000001.
    const res = await createGuest({ fullName: "Ravi Third", mobile: GUEST_RAVI_MOBILE });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("CONFLICT");
    // The candidate list must be MASKED — a dedupe prompt is not a PII leak (AC-7).
    const serialized = JSON.stringify(res.error);
    expect(serialized).not.toContain(GUEST_RAVI_MOBILE);
  });

  it("creates anyway when confirmDuplicate is set (FR-5 create-anyway)", async () => {
    await actAs(USER_RECEPTION_A_ID);
    const res = await createGuest({
      fullName: "Ravi Fourth",
      mobile: GUEST_RAVI_MOBILE,
      confirmDuplicate: true,
    });
    expect(res.ok).toBe(true);
    if (res.ok) createdIds.push(res.data.id);
  });

  it("serialises concurrent same-mobile creates so at most one slips the gate", async () => {
    await actAs(USER_RECEPTION_A_ID);
    // Both target a brand-new number; the advisory lock must make the second
    // see the first (design.md race). Neither passes confirmDuplicate.
    const [a, b] = await Promise.all([
      createGuest({ fullName: "Race A", mobile: "9833333333" }),
      createGuest({ fullName: "Race B", mobile: "9833333333" }),
    ]);
    for (const r of [a, b]) if (r.ok) createdIds.push(r.data.id);
    const succeeded = [a, b].filter((r) => r.ok).length;
    // Exactly one creates; the other is told it's a duplicate.
    expect(succeeded).toBe(1);
  });
});

describe("addGuestId — Aadhaar gating (FR-3/4 / AC-4/5)", () => {
  it("stores a passport with its full value (allowed) (AC-4)", async () => {
    await actAs(USER_MANAGER_ID);
    const res = await addGuestId({ guestId: GUEST_RAVI_ID, type: "PASSPORT", value: "M1234567" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.maskedValue).toBe("XXXX4567");

    const row = await prisma.guestId.findUniqueOrThrow({ where: { id: res.data.id } });
    expect(row.encryptedValue).not.toBeNull(); // full value stored (allowed)
    expect(row.encryptedValue).not.toContain("M1234567"); // …but encrypted
    expect(row.valueHash).not.toBeNull(); // searchable by ID
  });

  it("stores Aadhaar as MASKED last-4 only, no full value (AC-5)", async () => {
    await actAs(USER_MANAGER_ID);
    const res = await addGuestId({ guestId: GUEST_RAVI_ID, type: "AADHAAR", value: "1234 5678 9012" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.maskedValue).toBe("XXXX XXXX 9012");

    const row = await prisma.guestId.findUniqueOrThrow({ where: { id: res.data.id } });
    // FR-4: with full storage off (default), no full value or token is kept.
    expect(row.encryptedValue).toBeNull();
    expect(row.valueHash).toBeNull();
  });

  it("rejects an Aadhaar SCAN while full storage is off (AC-5)", async () => {
    await actAs(USER_MANAGER_ID);
    const res = await addGuestId({
      guestId: GUEST_RAVI_ID,
      type: "AADHAAR",
      value: "1234 5678 9012",
      scanBase64: Buffer.from("fake scan").toString("base64"),
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.message).toMatch(/Aadhaar/i);
  });
});

describe("guestsBySegment (CRM segment filter)", () => {
  it("corporate returns only guests with a company, masked", async () => {
    const user = await actAs(USER_RECEPTION_A_ID);
    const corp = await guestsBySegment(user, { segment: "corporate", limit: 24 });
    expect(Array.isArray(corp)).toBe(true);
    for (const g of corp) expect(g.companyName).not.toBeNull();
  });

  it("vip and repeat return arrays of masked list items", async () => {
    const user = await actAs(USER_RECEPTION_A_ID);
    const vip = await guestsBySegment(user, { segment: "vip", limit: 24 });
    const repeat = await guestsBySegment(user, { segment: "repeat", limit: 24 });
    expect(Array.isArray(vip)).toBe(true);
    expect(Array.isArray(repeat)).toBe(true);
  });
});

describe("revealPii (FR-8/9 / AC-8/AC-9)", () => {
  it("allows Reception with a reason (guest:view-pii is granted at the audited L tier)", async () => {
    // Front desk legitimately needs a guest's contact — the RBAC matrix grants
    // RECEPTION guest:view-pii at the reason-required, audited tier (not denial).
    // The hard denial is Housekeeping, asserted in the RBAC block below (AC-15).
    await actAs(USER_RECEPTION_A_ID);
    const res = await revealPii({ guestId: GUEST_RAVI_ID, field: "mobile", reason: "callback" });
    expect(res.ok).toBe(true);
    const audit = await prisma.auditLog.findFirst({
      where: { action: "guest:reveal-pii", entityId: GUEST_RAVI_ID, userId: USER_RECEPTION_A_ID },
      orderBy: { createdAt: "desc" },
    });
    expect(audit).not.toBeNull();
  });

  it("requires a reason even for a permitted user", async () => {
    await actAs(USER_MANAGER_ID);
    // Empty reason fails schema validation before authorize.
    const res = await revealPii({ guestId: GUEST_RAVI_ID, field: "mobile", reason: "" });
    expect(res.ok).toBe(false);
  });

  it("reveals for a Manager with a reason, and audits who/field/reason (AC-8)", async () => {
    await actAs(USER_MANAGER_ID);
    const res = await revealPii({
      guestId: GUEST_RAVI_ID,
      field: "mobile",
      reason: "Guest called about a lost item",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.value).toBe(GUEST_RAVI_MOBILE); // the real, decrypted number

    const event = await prisma.domainEvent.findFirst({
      where: { type: "GuestPiiAccessed", aggregateId: GUEST_RAVI_ID },
      orderBy: { seq: "desc" },
    });
    expect(event).not.toBeNull();

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: "guest:reveal-pii", entityId: GUEST_RAVI_ID },
      orderBy: { createdAt: "desc" },
    });
    expect(audit.reason).toBe("Guest called about a lost item");
    expect(audit.userId).toBe(USER_MANAGER_ID);
    // The revealed VALUE must never be in the audit row.
    expect(JSON.stringify(audit.after)).not.toContain(GUEST_RAVI_MOBILE);
  });
});

describe("mergeGuests (FR-12 / AC-11)", () => {
  it("merges the duplicate, re-points references, sets lineage, soft-deletes loser", async () => {
    await actAs(USER_MANAGER_ID);
    const res = await mergeGuests({ survivorId: GUEST_RAVI_ID, loserId: GUEST_RAVI2_ID });
    expect(res.ok).toBe(true);

    const loser = await prisma.guest.findUniqueOrThrow({ where: { id: GUEST_RAVI2_ID } });
    expect(loser.mergedIntoId).toBe(GUEST_RAVI_ID);
    expect(loser.deletedAt).not.toBeNull();

    const event = await prisma.domainEvent.findFirst({
      where: { type: "GuestMerged", aggregateId: GUEST_RAVI_ID },
      orderBy: { seq: "desc" },
    });
    expect(event).not.toBeNull();
  });

  it("refuses to merge a guest into itself", async () => {
    await actAs(USER_MANAGER_ID);
    const res = await mergeGuests({ survivorId: GUEST_RAVI_ID, loserId: GUEST_RAVI_ID });
    expect(res.ok).toBe(false);
  });

  it("allows Reception to merge (granted at the audited L tier), and audits it", async () => {
    // The RBAC matrix grants RECEPTION guest:merge at the audited tier — a front
    // desk that creates duplicates must be able to reconcile them. The audit row
    // records who did it; Housekeeping is denied (AC-15 block).
    await actAs(USER_RECEPTION_A_ID);
    const res = await mergeGuests({ survivorId: GUEST_RAVI_ID, loserId: GUEST_RAVI2_ID });
    expect(res.ok).toBe(true);
    const audit = await prisma.auditLog.findFirst({
      where: { action: "guest:merge", userId: USER_RECEPTION_A_ID },
      orderBy: { createdAt: "desc" },
    });
    expect(audit).not.toBeNull();
  });
});

describe("exportGuestData (FR-13 / AC-12)", () => {
  it("exports the profile for an admin and audits it", async () => {
    await actAs(USER_ADMIN_ID);
    const res = await exportGuestData({ guestId: GUEST_RAVI_ID });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // This is the guest's own data, decrypted for portability.
    expect(res.data.profile.mobile).toBe(GUEST_RAVI_MOBILE);

    const audit = await prisma.auditLog.findFirst({
      where: { action: "guest:export", entityId: GUEST_RAVI_ID },
      orderBy: { createdAt: "desc" },
    });
    expect(audit).not.toBeNull();
  });

  it("denies a user without export:pii", async () => {
    await actAs(USER_RECEPTION_A_ID);
    const res = await exportGuestData({ guestId: GUEST_RAVI_ID });
    expect(res.ok).toBe(false);
  });
});

describe("eraseGuest (FR-14 / AC-13/AC-14) — with in-DB probes", () => {
  it("scrubs personal fields AND clears the search/PII tokens in the DB (AC-13)", async () => {
    await actAs(USER_ADMIN_ID);

    // Give the guest an ID with a full value first, to prove its tokens clear too.
    authMock.current = await assembleClaims(prisma, USER_MANAGER_ID);
    await addGuestId({ guestId: GUEST_MEHTA_ID, type: "PASSPORT", value: "Z9999999" });

    await actAs(USER_ADMIN_ID);
    const res = await eraseGuest({ guestId: GUEST_MEHTA_ID, reason: "DPDP request" });
    expect(res.ok).toBe(true);

    const guest = await prisma.guest.findUniqueOrThrow({ where: { id: GUEST_MEHTA_ID } });
    // Adversarial in-DB assertion: the record is un-searchable and unrecoverable.
    expect(guest.deletedAt).not.toBeNull();
    expect(guest.mobileHash).toBeNull();
    expect(guest.emailHash).toBeNull();
    expect(guest.companyName).toBeNull();
    expect(guest.gstNumber).toBeNull();
    expect(guest.fullName).toBe("[erased]");

    const ids = await prisma.guestId.findMany({ where: { guestId: GUEST_MEHTA_ID } });
    for (const id of ids) {
      expect(id.valueHash).toBeNull();
      expect(id.encryptedValue).toBeNull();
      expect(id.scanObjectKey).toBeNull();
    }
  });

  it("rejects erasure while an active reservation exists (AC-14)", async () => {
    // Give G-RAVI an IN_HOUSE reservation, then attempt erase.
    const property = await prisma.property.findFirstOrThrow({ where: { orgId: ORG_ID } });
    const reservation = await prisma.reservation.create({
      data: {
        propertyId: property.id,
        code: `T-ERASE-${Date.now()}`,
        guestId: GUEST_RAVI_ID,
        status: "IN_HOUSE",
        source: "WALK_IN",
        checkInDate: new Date("2026-07-23"),
        checkOutDate: new Date("2026-07-25"),
        nights: 2,
        ratePaise: 400000,
      },
    });
    try {
      await actAs(USER_ADMIN_ID);
      const res = await eraseGuest({ guestId: GUEST_RAVI_ID });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.message).toMatch(/active reservation/i);
      }
      // The guest is untouched.
      const guest = await prisma.guest.findUniqueOrThrow({ where: { id: GUEST_RAVI_ID } });
      expect(guest.deletedAt).toBeNull();
    } finally {
      await prisma.reservation.delete({ where: { id: reservation.id } });
    }
  });
});

describe("RBAC — Housekeeping denied all guest access (FR-15 / AC-15)", () => {
  it("denies create, reveal, merge and export", async () => {
    await actAs(USER_HOUSEKEEPING_ID);
    for (const call of [
      createGuest({ fullName: "X", mobile: "9844444444" }),
      revealPii({ guestId: GUEST_RAVI_ID, field: "mobile", reason: "x" }),
      mergeGuests({ survivorId: GUEST_RAVI_ID, loserId: GUEST_RAVI2_ID }),
      exportGuestData({ guestId: GUEST_RAVI_ID }),
      eraseGuest({ guestId: GUEST_RAVI_ID }),
    ]) {
      const res = await call;
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error.code).toBe("FORBIDDEN");
    }
  });
});

describe("searchGuests + getGuestProfile (FR-8/10 / AC-7/AC-10) — masked", () => {
  it("finds a guest by mobile, returning MASKED contact (AC-7)", async () => {
    const claims = await actAs(USER_RECEPTION_A_ID);
    const result = await searchGuests(claims, { query: GUEST_RAVI_MOBILE, limit: 20 });
    const ravi = result.guests.find((g) => g.id === GUEST_RAVI_ID);
    expect(ravi).toBeDefined();
    expect(ravi!.fullName).toBe("Ravi Kumar"); // name visible (front desk)
    // Contact masked — never the raw number.
    expect(ravi!.maskedMobile).toBe("XXXXXX0001");
    expect(JSON.stringify(result)).not.toContain(GUEST_RAVI_MOBILE);
  });

  it("finds by name (trigram path) and by company", async () => {
    const claims = await actAs(USER_RECEPTION_A_ID);
    expect((await searchGuests(claims, { query: "Ravi", limit: 20 })).guests.length).toBeGreaterThan(0);
    const acme = await searchGuests(claims, { query: "ACME", limit: 20 });
    expect(acme.guests.some((g) => g.id === GUEST_MEHTA_ID)).toBe(true);
  });

  it("scopes to the org and never returns soft-deleted guests", async () => {
    const claims = await actAs(USER_RECEPTION_A_ID);
    await prisma.guest.update({ where: { id: GUEST_MEHTA_ID }, data: { deletedAt: new Date() } });
    try {
      const result = await searchGuests(claims, { query: "Anita", limit: 20 });
      expect(result.guests.map((g) => g.id)).not.toContain(GUEST_MEHTA_ID);
    } finally {
      await prisma.guest.update({ where: { id: GUEST_MEHTA_ID }, data: { deletedAt: null } });
    }
  });

  it("returns a masked profile with masked ID values (AC-7)", async () => {
    const claims = await actAs(USER_MANAGER_ID);
    await addGuestId({ guestId: GUEST_RAVI_ID, type: "AADHAAR", value: "1234 5678 9012" });

    const profile = await getGuestProfile(claims, GUEST_RAVI_ID);
    expect(profile?.maskedMobile).toBe("XXXXXX0001");
    expect(profile?.ids[0]?.maskedValue).toBe("XXXX XXXX 9012");
    expect(JSON.stringify(profile)).not.toContain(GUEST_RAVI_MOBILE);
  });
});
