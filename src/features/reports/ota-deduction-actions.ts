"use server";

/**
 * OTA deduction settings (client, 22 Nov 2026) — the commission %, GST on it,
 * TCS and TDS each channel withholds. Org-level; `settings:manage` to change,
 * audited (before → after). Reports → Channels reads them.
 */
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { authorize } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import { emitEvent } from "@/lib/events";
import { toResult, type Result } from "@/lib/result";
import { db } from "@/lib/db";
import { newRequestId, runWithContext } from "@/lib/context";
import { OTA_SOURCES } from "@/features/billing";

const bps = z.coerce.number().int().min(0).max(10_000);
const saveSchema = z.object({
  source: z.string().refine((s) => OTA_SOURCES.has(s), "Not an online channel"),
  commissionBps: bps,
  commissionOnGross: z.boolean(),
  gstOnCommissionBps: bps,
  tcsBps: bps,
  tdsBps: bps,
});

export async function saveChannelDeduction(input: unknown): Promise<Result<{ source: string }>> {
  return toResult(async () => {
    const data = saveSchema.parse(input);
    const user = await requireUser();
    authorize(user, "settings:manage", null);
    return runWithContext(
      { orgId: user.orgId, userId: user.userId, propertyScope: user.propertyScope, activePropertyId: user.activePropertyId, requestId: newRequestId(), ip: null, device: null },
      () => db.scoped(user).$transaction(async (tx) => {
        const before = await tx.channelDeduction.findUnique({ where: { orgId_source: { orgId: user.orgId, source: data.source } } });
        const { source, ...rates } = data;
        const row = await tx.channelDeduction.upsert({
          where: { orgId_source: { orgId: user.orgId, source } },
          create: { orgId: user.orgId, source, ...rates, updatedById: user.userId },
          update: { ...rates, updatedById: user.userId },
          select: { id: true },
        });
        await emitEvent(tx, { type: "ChannelDeductionChanged", aggregateId: row.id, payload: { source, ...rates } });
        await writeAudit(tx, {
          action: "settings:channel-deduction", entityType: "ChannelDeduction", entityId: row.id,
          before: before ? { commissionBps: before.commissionBps, commissionOnGross: before.commissionOnGross, gstOnCommissionBps: before.gstOnCommissionBps, tcsBps: before.tcsBps, tdsBps: before.tdsBps } : null,
          after: { source, ...rates },
        });
        return { source };
      }),
    );
  });
}
