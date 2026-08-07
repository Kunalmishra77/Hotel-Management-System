"use server";

/**
 * Org security-settings admin action (module 16 — FR-1/4/5/7). Admin-only.
 * Canonical write path: validate → authorize → transaction → event → audit →
 * Result. These values are the SOURCE for password policy, lockout, session TTL,
 * 2FA enforcement, and the audited-discount threshold — every write is audited.
 * The `update` clause is authoritative so a save always lands the full state.
 */
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { authorize } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import { emitEvent } from "@/lib/events";
import { toResult, type Result } from "@/lib/result";
import { updateSecuritySettingsSchema } from "./schema";
import { assertOrgWide, settingsDb, withSettingsContext } from "./internal";

export async function updateSecuritySettings(input: unknown): Promise<Result<{ ok: true }>> {
  return toResult(async () => {
    const data = updateSecuritySettingsSchema.parse(input);
    const admin = await requireUser();
    authorize(admin, "settings:manage");
    assertOrgWide(admin);

    await withSettingsContext(admin, () =>
      settingsDb.$transaction(async (tx) => {
        const before = await tx.securitySettings.findUnique({ where: { orgId: admin.orgId } });
        await tx.securitySettings.upsert({
          where: { orgId: admin.orgId },
          create: { orgId: admin.orgId, ...data },
          update: data,
        });
        await emitEvent(tx, {
          type: "SecuritySettingsChanged",
          aggregateId: admin.orgId,
          payload: { enforced2faRoles: data.enforced2faRoles },
        });
        await writeAudit(tx, {
          action: "settings:security-update",
          entityType: "SecuritySettings",
          entityId: admin.orgId,
          before: before
            ? {
                passwordMinLength: before.passwordMinLength,
                lockoutThreshold: before.lockoutThreshold,
                sessionTtlMinutes: before.sessionTtlMinutes,
                discountThresholdPaise: before.discountThresholdPaise,
                enforced2faRoles: before.enforced2faRoles,
              }
            : null,
          after: data,
        });
      }),
    );

    revalidatePath("/settings");
    return { ok: true as const };
  });
}
