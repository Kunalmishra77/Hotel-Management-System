/**
 * 15 search & export integration — T-5/6/7/8 (FR-1..7, AC-1/3/6/7/8/10/11/12).
 * Federated search over the owning modules, structured-query guardrail, and the
 * PII-gated export. Auth mocked at the boundary. A dedicated guest is seeded so
 * other suites' erase/merge mutations can't perturb these assertions.
 */
import { vi } from "vitest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient } from "@/lib/db/client";
import type { SessionClaims } from "@/lib/auth/claims";

vi.mock("@/lib/auth", () => ({ requireUser: async () => { throw new Error("unused"); } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

import { ORG_ID, PROP_A_ID, USER_MANAGER_ID, USER_ACCOUNTS_ID, USER_HOUSEKEEPING_ID } from "../../prisma/seed/fixtures";
import { assembleClaims } from "@/lib/auth/claims";
import { encryptString } from "@/lib/crypto/encryption";
import { mobileToken } from "@/features/guests/internal";
import { search } from "@/features/search/queries";
import { runStructuredQuery } from "@/features/search/structured";
import { runExport } from "@/features/search/actions";
import { resolveStorageAdapter } from "@/lib/storage";

const prisma = createPrismaClient();
const MOBILE = "9812345678";
const CITY = "Zephyrville";
const COMPANY = "ZEBRACORP-15";
const GID = "srch_guest_15";

async function claims(userId: string): Promise<SessionClaims> {
  const c = await assembleClaims(prisma, userId);
  if (!c) throw new Error("no claims");
  return c;
}

beforeAll(async () => {
  await prisma.guest.upsert({
    where: { id: GID },
    create: { id: GID, orgId: ORG_ID, fullName: "Search Fixture", mobile: encryptString(MOBILE), mobileHash: mobileToken(MOBILE), city: CITY, companyName: COMPANY, state: "Karnataka" },
    update: { deletedAt: null, mobile: encryptString(MOBILE), mobileHash: mobileToken(MOBILE), city: CITY, companyName: COMPANY },
  });
});
afterAll(async () => {
  await prisma.guest.deleteMany({ where: { id: GID } });
  await prisma.$disconnect();
});

describe("unified search (AC-1/8/12)", () => {
  it("finds a guest by exact mobile (indexed hash, no scan)", async () => {
    const page = await search(await claims(USER_MANAGER_ID), { keyword: MOBILE });
    const hit = page.results.find((r) => r.id === GID);
    expect(hit).toBeDefined();
    expect(hit!.entity).toBe("guest");
    expect(hit!.fields.mobile).not.toBe(MOBILE); // masked, never raw (FR-3)
  });

  it("finds a guest by company and by city (§4 facets)", async () => {
    const byCompany = await search(await claims(USER_MANAGER_ID), { keyword: COMPANY });
    expect(byCompany.results.some((r) => r.id === GID)).toBe(true);
    const byCity = await search(await claims(USER_MANAGER_ID), { keyword: CITY });
    expect(byCity.results.some((r) => r.id === GID)).toBe(true);
  });

  it("returns an empty, non-error result for no matches (AC-8)", async () => {
    const page = await search(await claims(USER_MANAGER_ID), { keyword: "zzz-no-such-term-9999" });
    expect(page.results).toEqual([]);
  });

  it("treats SQL/regex special characters as a literal — no injection, no error (AC-12)", async () => {
    const page = await search(await claims(USER_MANAGER_ID), { keyword: "'; drop table guest; -- %" });
    expect(Array.isArray(page.results)).toBe(true); // ran safely, parameterised
  });
});

describe("RBAC on search (AC-3/AC-7)", () => {
  it("housekeeping (no guest:view) gets no guest results", async () => {
    const page = await search(await claims(USER_HOUSEKEEPING_ID), { keyword: MOBILE });
    expect(page.results.some((r) => r.entity === "guest")).toBe(false);
  });
});

describe("structured query — the 18-ai path (AC-6/AC-11)", () => {
  it("validates + executes a whitelisted single-entity query, masked", async () => {
    const rows = await runStructuredQuery(await claims(USER_MANAGER_ID), {
      entity: "guest",
      filters: [{ field: "city", op: "eq", value: CITY }],
    });
    const hit = rows.find((r) => r.id === GID);
    expect(hit).toBeDefined();
    expect(hit!.fields.mobile).not.toBe(MOBILE); // masked
  });

  it("rejects a non-whitelisted field and never executes it (AC-11)", async () => {
    await expect(
      runStructuredQuery(await claims(USER_MANAGER_ID), { entity: "guest", filters: [{ field: "mobileHash", op: "eq", value: "x" }] }),
    ).rejects.toMatchObject({ code: "INVALID_QUERY" });
  });
});

describe("export (AC-4/5/7/10)", () => {
  it("a manager with export:pii gets a DONE job with full PII, audited (AC-4/5/7)", async () => {
    const res = await runExport(await claims(USER_ACCOUNTS_ID), { keyword: MOBILE, entities: ["guest"], format: "csv" });
    expect(res.status).toBe("DONE");
    expect(res.includesPii).toBe(true);
    expect(res.rowCount).toBeGreaterThanOrEqual(1);

    const csv = (await resolveStorageAdapter().get(res.objectKey!)).toString("utf8");
    expect(csv.split("\r\n")[0]).toContain("mobile"); // PII column present for export:pii
    expect(csv).toContain(MOBILE); // raw value, because the caller may export PII

    const audit = await prisma.auditLog.findFirst({ where: { entityType: "ExportJob", entityId: res.jobId } });
    expect(audit).not.toBeNull();
    const job = await prisma.exportJob.findUnique({ where: { id: res.jobId } });
    expect(job?.includesPii).toBe(true);
  });

  it("omits PII columns when the caller lacks export:pii (AC-5)", async () => {
    const c = await claims(USER_ACCOUNTS_ID);
    const noPii: SessionClaims = { ...c, resolvedPermissions: c.resolvedPermissions.filter((p) => p !== "export:pii") };
    const res = await runExport(noPii, { keyword: MOBILE, entities: ["guest"], format: "csv" });
    expect(res.includesPii).toBe(false);
    const csv = (await resolveStorageAdapter().get(res.objectKey!)).toString("utf8");
    expect(csv.split("\r\n")[0]).not.toContain("mobile"); // PII column omitted
    expect(csv).not.toContain(MOBILE);
  });

  it("queues an async ExportJob when over the threshold (AC-10)", async () => {
    const res = await runExport(await claims(USER_ACCOUNTS_ID), { keyword: MOBILE, entities: ["guest"], format: "xlsx" }, 0);
    expect(res.status).toBe("QUEUED");
    expect(res.objectKey).toBeNull();
    const job = await prisma.exportJob.findUnique({ where: { id: res.jobId } });
    expect(job?.status).toBe("QUEUED");
  });

  it("denies export to a role without export:data (AC-7)", async () => {
    await expect(
      runExport(await claims(USER_HOUSEKEEPING_ID), { keyword: MOBILE, entities: ["guest"], format: "csv" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
