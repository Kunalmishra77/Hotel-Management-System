/**
 * 03 Form C / FRRO register + submission tracking — T-38 (FR-25/26, AC-28/29/30).
 *
 * The C-Form itself is generated at check-in (covered by the check-in flow); this
 * suite covers the register read (scoped, masked) and the submission lifecycle
 * (GENERATED → SUBMITTED, idempotent, RBAC). Auth is mocked at the boundary; the
 * rest is real against the test DB — real events + audit.
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
  USER_RECEPTION_A_ID,
  USER_ACCOUNTS_ID,
  USER_HOUSEKEEPING_ID,
} from "../../prisma/seed/fixtures";
import { assembleClaims } from "@/lib/auth/claims";
import { markCFormSubmitted } from "@/features/reservations/cform-actions";
import { listCForms } from "@/features/reservations/queries";

const prisma = createPrismaClient();
let CFORM_ID = "";
let RES_ID = "";

async function actAs(userId: string): Promise<SessionClaims> {
  const claims = await assembleClaims(prisma, userId);
  if (!claims) throw new Error(`no claims for ${userId}`);
  authMock.current = claims;
  return claims;
}

beforeAll(async () => {
  await prisma.$queryRawUnsafe("SELECT 1"); // warm the pooled connection (cold start)

  const r = await prisma.reservation.findFirst({
    where: { propertyId: PROP_A_ID },
    select: { id: true, guestId: true },
  });
  if (!r) throw new Error("seed has no PROP-A reservation to attach a Form C to");
  RES_ID = r.id;

  await prisma.cForm.deleteMany({ where: { reservationId: RES_ID } });
  const cf = await prisma.cForm.create({
    data: {
      propertyId: PROP_A_ID,
      reservationId: RES_ID,
      guestId: r.guestId,
      nationality: "British",
      details: { guestName: "Test Foreign Guest", nationality: "British", passportMasked: "XXXXXX234" },
      pdfObjectKey: "cforms/test/cform.pdf",
      status: "GENERATED",
    },
    select: { id: true },
  });
  CFORM_ID = cf.id;
});

afterAll(async () => {
  // AuditLog + DomainEvent are DB-enforced append-only — leave those rows (harmless
  // test artifacts, as other suites do). Only the CForm we created is removed.
  await prisma.cForm.deleteMany({ where: { id: CFORM_ID } });
  await prisma.$disconnect();
});

describe("Form C register — scoped + masked (AC-28)", () => {
  it("lists the property's C-Forms with nationality but no ID numbers", async () => {
    const user = await actAs(USER_RECEPTION_A_ID);
    const { cforms } = await listCForms(user, { propertyId: PROP_A_ID });
    const item = cforms.find((c) => c.id === CFORM_ID);
    expect(item).toBeDefined();
    expect(item!.nationality).toBe("British");
    expect(item!.status).toBe("GENERATED");
    expect(item!.hasPdf).toBe(true);
    // No passport/visa number leaks into the register payload (compliance.md).
    const keys = Object.keys(item!);
    expect(keys).not.toContain("passportNumber");
    expect(keys).not.toContain("passportMasked");
    expect(keys).not.toContain("visaNumber");
    expect(JSON.stringify(item)).not.toContain("XXXXXX234");
  });

  it("rejects listing a property outside the caller's scope", async () => {
    const user = await actAs(USER_RECEPTION_A_ID);
    await expect(listCForms(user, { propertyId: PROP_B_ID })).rejects.toMatchObject({ code: "OUT_OF_SCOPE" });
  });
});

describe("Form C submission lifecycle (AC-29)", () => {
  it("records the FRRO reference (GENERATED → SUBMITTED), emits + audits, idempotent", async () => {
    await actAs(USER_RECEPTION_A_ID);
    const res = await markCFormSubmitted({ cformId: CFORM_ID, submissionRef: "FRRO-TEST-001" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.status).toBe("SUBMITTED");
    expect(res.data.submissionRef).toBe("FRRO-TEST-001");

    const row = await prisma.cForm.findUnique({ where: { id: CFORM_ID }, select: { status: true, submissionRef: true } });
    expect(row).toEqual({ status: "SUBMITTED", submissionRef: "FRRO-TEST-001" });

    const event = await prisma.domainEvent.findFirst({ where: { type: "CFormSubmitted", aggregateId: CFORM_ID } });
    expect(event).not.toBeNull();
    const audit = await prisma.auditLog.findFirst({ where: { action: "reservation:cform-submit", entityId: CFORM_ID } });
    expect(audit).not.toBeNull();

    // Idempotent: same ref again is a no-op — no second event written.
    const again = await markCFormSubmitted({ cformId: CFORM_ID, submissionRef: "FRRO-TEST-001" });
    expect(again.ok).toBe(true);
    const eventCount = await prisma.domainEvent.count({ where: { type: "CFormSubmitted", aggregateId: CFORM_ID } });
    expect(eventCount).toBe(1);
  });
});

describe("Form C submission RBAC (AC-30)", () => {
  it("denies housekeeping (no checkin:perform)", async () => {
    await actAs(USER_HOUSEKEEPING_ID);
    const res = await markCFormSubmitted({ cformId: CFORM_ID, submissionRef: "X" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("FORBIDDEN");
  });

  it("lets accounts view the register but not record submission", async () => {
    const user = await actAs(USER_ACCOUNTS_ID);
    const { cforms } = await listCForms(user, { propertyId: PROP_A_ID });
    expect(cforms.some((c) => c.id === CFORM_ID)).toBe(true);
    const res = await markCFormSubmitted({ cformId: CFORM_ID, submissionRef: "Y" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("FORBIDDEN");
  });
});
