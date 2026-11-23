"use server";

/**
 * Saved companies for GST bills (client, 22 Nov 2026 — company bills). Staff type
 * two letters of a company and pick it: name, GSTIN, address and state fill the
 * bill. A company GST bill saves (or refreshes) its company here, so the list
 * builds itself. Org-level master data (Corporate); anyone who can issue a bill
 * (`invoice:generate`) can search and save — credit limits stay `corporate:manage`.
 */
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { authorize } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import { emitEvent } from "@/lib/events";
import { toResult, type Result } from "@/lib/result";
import { isValidGstin, normalizeGstin } from "@/lib/gstin";
import { corporateDb, withCorporateContext } from "./internal";

export type BillingCompany = { id: string; name: string; gstin: string | null; address: string | null; state: string | null };

const searchSchema = z.object({ q: z.string().trim().max(100) });
const saveSchema = z.object({
  name: z.string().trim().min(1).max(200),
  // Optional: a credit company is often entered "as it comes" (client, 23 Nov 2026).
  gstin: z.string().optional().transform((v) => (v ? normalizeGstin(v) : undefined)).refine((v) => v === undefined || isValidGstin(v), "Invalid GSTIN"),
  address: z.string().trim().max(300).optional(),
  state: z.string().trim().max(60).optional(),
});

export async function searchBillingCompanies(input: unknown): Promise<Result<BillingCompany[]>> {
  return toResult(async () => {
    const { q } = searchSchema.parse(input);
    const user = await requireUser();
    authorize(user, "invoice:generate", null);
    if (q.length < 2) return [];
    return corporateDb(user).corporate.findMany({
      where: { orgId: user.orgId, OR: [{ name: { contains: q, mode: "insensitive" } }, { gstin: { startsWith: q.toUpperCase() } }] },
      select: { id: true, name: true, gstin: true, address: true, state: true },
      orderBy: { name: "asc" },
      take: 8,
    });
  });
}

/** Save the company of a bill — matched by GSTIN (one company per GSTIN), else by exact name. */
export async function saveBillingCompany(input: unknown): Promise<Result<{ id: string; created: boolean }>> {
  return toResult(async () => {
    const data = saveSchema.parse(input);
    const user = await requireUser();
    authorize(user, "invoice:generate", null);
    return withCorporateContext(user, () =>
      corporateDb(user).$transaction(async (tx) => {
        const existing = await tx.corporate.findFirst({
          where: data.gstin ? { orgId: user.orgId, gstin: data.gstin } : { orgId: user.orgId, gstin: null, name: { equals: data.name, mode: "insensitive" } },
          select: { id: true, name: true, address: true, state: true },
        });
        const fields = { name: data.name, address: data.address ?? existing?.address ?? null, state: data.state ?? existing?.state ?? null };
        if (existing) {
          if (existing.name === fields.name && existing.address === fields.address && existing.state === fields.state) return { id: existing.id, created: false };
          await tx.corporate.update({ where: { id: existing.id }, data: fields });
          await writeAudit(tx, { action: "corporate:update-billing", entityType: "Corporate", entityId: existing.id, before: { name: existing.name, address: existing.address, state: existing.state }, after: fields });
          return { id: existing.id, created: false };
        }
        const corp = await tx.corporate.create({ data: { orgId: user.orgId, gstin: data.gstin ?? null, creditLimitPaise: 0n, ...fields }, select: { id: true } });
        await emitEvent(tx, { type: "CorporateCreated", aggregateId: corp.id, payload: { name: data.name, creditLimitPaise: 0, from: "gst-bill" } });
        await writeAudit(tx, { action: "corporate:create", entityType: "Corporate", entityId: corp.id, after: { name: data.name, gstin: data.gstin ?? null, from: "gst-bill" } });
        return { id: corp.id, created: true };
      }),
    );
  });
}
