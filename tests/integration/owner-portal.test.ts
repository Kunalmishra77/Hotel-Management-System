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
  USER_MANAGER_ID,
  USER_OWNER_A_ID,
  USER_RECEPTION_A_ID,
} from "../../prisma/seed/fixtures";
import { assembleClaims } from "@/lib/auth/claims";
import { ownerFinancials, listOwnerDocuments, getOwnerDocumentBytes } from "@/features/owner-portal/queries";
import { uploadOwnerDocument, deleteOwnerDocument } from "@/features/owner-portal/document-actions";

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
  await prisma.propertyDocument.deleteMany({ where: { title: { startsWith: "OP-TEST" } } });
  await prisma.$disconnect();
});

const B64 = Buffer.from("owner portal test document").toString("base64");

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

describe("Document vault (AC-6/7/8/9)", () => {
  it("owner uploads (role OWNER) with event + audit; staff upload is role STAFF", async () => {
    const owner = await actAs(USER_OWNER_A_ID);
    const up = await uploadOwnerDocument({
      propertyId: PROP_A_ID, category: "AGREEMENT", title: "OP-TEST owner doc",
      contentType: "text/plain", fileBase64: B64,
    });
    expect(up.ok).toBe(true);
    if (!up.ok) return;
    const row = await prisma.propertyDocument.findUnique({ where: { id: up.data.id }, select: { uploadedByRole: true, propertyId: true } });
    expect(row).toEqual({ uploadedByRole: "OWNER", propertyId: PROP_A_ID });
    expect(await prisma.domainEvent.findFirst({ where: { type: "PropertyDocumentUploaded", aggregateId: up.data.id } })).not.toBeNull();
    expect(await prisma.auditLog.findFirst({ where: { action: "owner:document-upload", entityId: up.data.id } })).not.toBeNull();

    const mgr = await actAs(USER_MANAGER_ID); // owner:manage → uploads as STAFF
    const upS = await uploadOwnerDocument({
      propertyId: PROP_A_ID, category: "LICENCE", title: "OP-TEST staff doc",
      contentType: "text/plain", fileBase64: B64,
    });
    expect(upS.ok).toBe(true);
    if (!upS.ok) return;
    const rowS = await prisma.propertyDocument.findUnique({ where: { id: upS.data.id }, select: { uploadedByRole: true } });
    expect(rowS?.uploadedByRole).toBe("STAFF");
  });

  it("lists scoped docs with correct canDelete, and download writes an access audit (AC-8)", async () => {
    const owner = await actAs(USER_OWNER_A_ID);
    const docs = await listOwnerDocuments(owner, { propertyId: PROP_A_ID });
    const ownDoc = docs.find((x) => x.title === "OP-TEST owner doc");
    const staffDoc = docs.find((x) => x.title === "OP-TEST staff doc");
    expect(ownDoc?.canDelete).toBe(true); // owner can delete own
    expect(staffDoc?.canDelete).toBe(false); // but not a staff upload

    const dl = await getOwnerDocumentBytes(owner, ownDoc!.id);
    expect(dl.bytes.toString()).toBe("owner portal test document");
    expect(await prisma.auditLog.findFirst({ where: { action: "owner:document-download", entityId: ownDoc!.id } })).not.toBeNull();
  });

  it("owner cannot delete a staff-uploaded document, but can delete their own (AC-9)", async () => {
    const owner = await actAs(USER_OWNER_A_ID);
    const docs = await listOwnerDocuments(owner, { propertyId: PROP_A_ID });
    const staffDoc = docs.find((x) => x.title === "OP-TEST staff doc")!;
    const ownDoc = docs.find((x) => x.title === "OP-TEST owner doc")!;

    const denied = await deleteOwnerDocument({ documentId: staffDoc.id });
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.error.code).toBe("FORBIDDEN");

    const ok = await deleteOwnerDocument({ documentId: ownDoc.id });
    expect(ok.ok).toBe(true);
    const row = await prisma.propertyDocument.findUnique({ where: { id: ownDoc.id }, select: { deletedAt: true } });
    expect(row?.deletedAt).not.toBeNull(); // soft-deleted
  });

  it("denies upload for a non-owner, non-manager role (AC-18)", async () => {
    await actAs(USER_RECEPTION_A_ID);
    const res = await uploadOwnerDocument({
      propertyId: PROP_A_ID, category: "OTHER", title: "OP-TEST nope",
      contentType: "text/plain", fileBase64: B64,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("FORBIDDEN");
  });
});
