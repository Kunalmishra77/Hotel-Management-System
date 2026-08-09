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
  USER_ADMIN_ID,
  USER_MANAGER_ID,
  USER_OWNER_A_ID,
  USER_RECEPTION_A_ID,
} from "../../prisma/seed/fixtures";
import { assembleClaims } from "@/lib/auth/claims";
import { ownerFinancials, listOwnerDocuments, getOwnerDocumentBytes, ownerSchedule, listOwnerPayouts, getPayoutStatementBytes } from "@/features/owner-portal/queries";
import { uploadOwnerDocument, deleteOwnerDocument } from "@/features/owner-portal/document-actions";
import { createImportantDate, deleteImportantDate } from "@/features/owner-portal/schedule-actions";
import { recordOwnerPayout, markPayoutPaid } from "@/features/owner-portal/payout-actions";

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
const PAYOUT_MONTH = "2024-02";
afterAll(async () => {
  await prisma.propertyDocument.deleteMany({ where: { title: { startsWith: "OP-TEST" } } });
  await prisma.propertyImportantDate.deleteMany({ where: { label: { startsWith: "OP-TEST" } } });
  try {
    await prisma.ownerPayout.deleteMany({ where: { propertyId: PROP_A_ID, periodMonth: d(`${PAYOUT_MONTH}-01`) } });
  } catch {
    /* if the payout ledger is DB-append-only, leave the test row */
  }
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

describe("Schedule (AC-10/11/12)", () => {
  it("manager adds an important date; it appears in the owner's schedule with overdue flag", async () => {
    const mgr = await actAs(USER_MANAGER_ID); // owner:manage
    const past = await createImportantDate({ propertyId: PROP_A_ID, kind: "GST", label: "OP-TEST overdue GST", dueDate: "2020-01-01" });
    const future = await createImportantDate({ propertyId: PROP_A_ID, kind: "INSURANCE", label: "OP-TEST future insurance", dueDate: "2099-01-01" });
    expect(past.ok && future.ok).toBe(true);
    if (!past.ok) return;
    expect(await prisma.domainEvent.findFirst({ where: { type: "ImportantDateChanged", aggregateId: past.data.id } })).not.toBeNull();
    expect(await prisma.auditLog.findFirst({ where: { action: "owner:important-date-create", entityId: past.data.id } })).not.toBeNull();

    const owner = await actAs(USER_OWNER_A_ID);
    const view = await ownerSchedule(owner, { propertyId: PROP_A_ID, from: d("2026-07-01"), to: d("2026-08-01") });
    const overdue = view.importantDates.find((x) => x.label === "OP-TEST overdue GST");
    const future2 = view.importantDates.find((x) => x.label === "OP-TEST future insurance");
    expect(overdue?.overdue).toBe(true);
    expect(future2?.overdue).toBe(false);
    expect(Array.isArray(view.maintenance)).toBe(true);
    expect(Array.isArray(view.occupancy)).toBe(true); // counts-only, no PII
  });

  it("denies an owner (no owner:manage) from adding a date (AC-12)", async () => {
    await actAs(USER_OWNER_A_ID);
    const res = await createImportantDate({ propertyId: PROP_A_ID, kind: "OTHER", label: "OP-TEST nope", dueDate: "2030-01-01" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("FORBIDDEN");
  });

  it("manager can delete an important date (soft-delete)", async () => {
    const mgr = await actAs(USER_MANAGER_ID);
    const created = await createImportantDate({ propertyId: PROP_A_ID, kind: "AMC", label: "OP-TEST amc", dueDate: "2027-06-01" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const del = await deleteImportantDate({ dateId: created.data.id });
    expect(del.ok).toBe(true);
    const row = await prisma.propertyImportantDate.findUnique({ where: { id: created.data.id }, select: { deletedAt: true } });
    expect(row?.deletedAt).not.toBeNull();
  });
});

describe("Payout — management-fee model (AC-13/15/16/17)", () => {
  it("records a payout: snapshot + net = revenue − expense − fee, idempotent, event + audit", async () => {
    await prisma.ownerPayout.deleteMany({ where: { propertyId: PROP_A_ID, periodMonth: d(`${PAYOUT_MONTH}-01`) } }).catch(() => {});
    const admin = await actAs(USER_ADMIN_ID); // owner:payout-manage
    const rec = await recordOwnerPayout({ propertyId: PROP_A_ID, periodMonth: `${PAYOUT_MONTH}-15` });
    expect(rec.ok).toBe(true);
    if (!rec.ok) return;
    expect(rec.data.idempotent).toBe(false);

    const row = await prisma.ownerPayout.findUnique({ where: { id: rec.data.id } });
    expect(row).not.toBeNull();
    expect(row!.managementFeeBps).toBe(1500); // PROP-A seed = 15%
    // Net is exactly revenue − expense − fee, and fee = 15% of revenue (paise/BigInt).
    expect(row!.managementFeePaise).toBe((row!.grossRevenuePaise * 1500n) / 10000n);
    expect(row!.netPayablePaise).toBe(row!.grossRevenuePaise - row!.expensePaise - row!.managementFeePaise);
    expect(row!.status).toBe("COMPUTED");

    expect(await prisma.domainEvent.findFirst({ where: { type: "OwnerPayoutRecorded", aggregateId: rec.data.id } })).not.toBeNull();
    expect(await prisma.auditLog.findFirst({ where: { action: "owner:payout-record", entityId: rec.data.id } })).not.toBeNull();

    // Idempotent per (property, month).
    const again = await recordOwnerPayout({ propertyId: PROP_A_ID, periodMonth: `${PAYOUT_MONTH}-01` });
    expect(again.ok && again.data.idempotent).toBe(true);
    const count = await prisma.ownerPayout.count({ where: { propertyId: PROP_A_ID, periodMonth: d(`${PAYOUT_MONTH}-01`) } });
    expect(count).toBe(1);
  });

  it("marks a payout paid (COMPUTED → PAID) with ref, event + audit; re-mark is a no-op", async () => {
    const admin = await actAs(USER_ADMIN_ID);
    const list = await listOwnerPayouts(admin, { propertyId: PROP_A_ID });
    const payout = list.find((p) => p.period === PAYOUT_MONTH)!;
    const paid = await markPayoutPaid({ payoutId: payout.id, paymentRef: "UTR-OP-TEST-1" });
    expect(paid.ok).toBe(true);
    if (!paid.ok) return;
    expect(paid.data.status).toBe("PAID");
    const row = await prisma.ownerPayout.findUnique({ where: { id: payout.id }, select: { status: true, paymentRef: true, paidAt: true } });
    expect(row).toMatchObject({ status: "PAID", paymentRef: "UTR-OP-TEST-1" });
    expect(row!.paidAt).not.toBeNull();
    expect(await prisma.domainEvent.findFirst({ where: { type: "OwnerPayoutPaid", aggregateId: payout.id } })).not.toBeNull();

    const again = await markPayoutPaid({ payoutId: payout.id, paymentRef: "UTR-DIFFERENT" });
    expect(again.ok && again.data.status).toBe("PAID"); // no-op, ref unchanged
    const after = await prisma.ownerPayout.findUnique({ where: { id: payout.id }, select: { paymentRef: true } });
    expect(after?.paymentRef).toBe("UTR-OP-TEST-1");
  });

  it("owner can view + download a statement, but cannot record or mark paid (AC-17/19)", async () => {
    const owner = await actAs(USER_OWNER_A_ID);
    const list = await listOwnerPayouts(owner, { propertyId: PROP_A_ID });
    const payout = list.find((p) => p.period === PAYOUT_MONTH)!;
    expect(payout).toBeDefined();

    const pdf = await getPayoutStatementBytes(owner, payout.id);
    expect(pdf.bytes.subarray(0, 4).toString()).toBe("%PDF");

    const rec = await recordOwnerPayout({ propertyId: PROP_A_ID, periodMonth: `${PAYOUT_MONTH}-01` });
    expect(rec.ok).toBe(false);
    if (!rec.ok) expect(rec.error.code).toBe("FORBIDDEN");
    const pay = await markPayoutPaid({ payoutId: payout.id, paymentRef: "X" });
    expect(pay.ok).toBe(false);
    if (!pay.ok) expect(pay.error.code).toBe("FORBIDDEN");
  });
});
