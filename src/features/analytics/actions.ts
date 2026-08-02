"use server";

/**
 * Analytics actions — 14 T-20. Manual night-audit trigger, behind permission
 * (AC-7). The orchestration itself runs under a system context inside
 * `runNightAudit`; this is just the permissioned, audited entry point.
 */
import { requireUser } from "@/lib/auth";
import { authorize } from "@/lib/permissions";
import { NotFoundError } from "@/lib/errors";
import { toResult, type Result } from "@/lib/result";
import { db } from "@/lib/db";
import { runNightAudit, type NightAuditResult } from "./night-audit";
import { z } from "zod";

const schema = z.object({ propertyId: z.string().min(1) });

export async function runNightAuditAction(input: unknown): Promise<Result<NightAuditResult>> {
  return toResult(async () => {
    const { propertyId } = schema.parse(input);
    const user = await requireUser();
    authorize(user, "report:view-financial", propertyId);

    const property = await db.scoped(user).property.findFirst({ where: { id: propertyId }, select: { currentBusinessDate: true } });
    if (!property) throw new NotFoundError("Property not found.");
    // Close the current business date (or today, before the first roll).
    const businessDate = property.currentBusinessDate ?? new Date(new Date().toISOString().slice(0, 10) + "T00:00:00.000Z");
    return runNightAudit(propertyId, businessDate);
  });
}
