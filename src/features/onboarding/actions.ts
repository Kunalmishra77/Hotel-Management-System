"use server";
/**
 * Org self-onboarding (architecture v2 · SaaS multi-tenant). A new hotel chain
 * signs up: this creates the tenant Organization (on a free trial), its security
 * settings, and the first ADMINISTRATOR user. Public, unauthenticated — the tenant
 * doesn't exist yet, so writes run in a plain transaction (the first sign-in audits).
 *
 * Isolation is by construction: every operational row already carries orgId and is
 * queried through the property-scoped helper, so a fresh org sees only its own data.
 */
import { z } from "zod";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { ConflictError } from "@/lib/errors";
import { toResult, type Result } from "@/lib/result";

export const startTrialSchema = z.object({
  orgName: z.string().trim().min(2, "Enter your company name.").max(120),
  adminName: z.string().trim().min(2, "Enter your name.").max(120),
  email: z.string().trim().email("Enter a valid email.").max(200),
  password: z.string().min(10, "Password must be at least 10 characters.").max(200),
});
export type StartTrialInput = z.input<typeof startTrialSchema>;

export async function startTrial(raw: unknown): Promise<Result<{ email: string }>> {
  return toResult(async () => {
    const data = startTrialSchema.parse(raw);

    const existing = await db.unscoped().user.findUnique({ where: { email: data.email }, select: { id: true } });
    if (existing) throw new ConflictError("An account with this email already exists.");

    const passwordHash = await hashPassword(data.password);

    await db.unscoped().$transaction(async (tx) => {
      const org = await tx.organization.create({
        data: { name: data.orgName, plan: "CORE", planStatus: "TRIAL" },
        select: { id: true },
      });
      await tx.securitySettings.create({ data: { orgId: org.id } });
      const user = await tx.user.create({
        data: { orgId: org.id, email: data.email, name: data.adminName, passwordHash, isActive: true },
        select: { id: true },
      });
      await tx.roleAssignment.create({ data: { userId: user.id, role: "ADMINISTRATOR", propertyIds: [] } });
    });

    return { email: data.email };
  });
}
