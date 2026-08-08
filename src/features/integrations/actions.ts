"use server";

/**
 * Integrations console actions (16/12). The one write surface: enable a
 * messaging channel and switch it sandbox↔live. Mirrors 22's `configureAccounting`
 * — validate → authorize (`integration:manage`, Administrator-only, org-level) →
 * upsert the config row → audit → typed Result. Going live is a CONFIG change,
 * never a code change (integrations.md FR-23).
 *
 * Audit-only (no domain event): like `configureAccounting`, a provider/mode
 * config change is platform configuration, not a business event that comms/AI/
 * analytics consume. It is still fully audited (who/when/before/after).
 *
 * Flipping to "live" is safe here: `resolveMessagingProvider` returns the honest
 * live stub, which refuses to send until the external blocker (Meta WABA / TRAI
 * DLT / SPF-DKIM) is cleared — the app never sends a real message by accident.
 */
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { authorize } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import { toResult, type Result } from "@/lib/result";
import { setMessagingModeSchema } from "./schema";
import { integrationsDb, withIntegrationsContext } from "./internal";

export type SetMessagingModeResult = { channel: string; provider: string; mode: string };

export async function setMessagingMode(input: unknown): Promise<Result<SetMessagingModeResult>> {
  return toResult(async () => {
    const data = setMessagingModeSchema.parse(input);
    const user = await requireUser();
    authorize(user, "integration:manage", null); // org-level; Administrator-only
    const prisma = integrationsDb();

    return withIntegrationsContext(user, () =>
      prisma.$transaction(async (tx) => {
        const before = await tx.messagingAccount.findUnique({
          where: {
            orgId_channel_provider: {
              orgId: user.orgId,
              channel: data.channel,
              provider: data.provider,
            },
          },
          select: { mode: true },
        });

        const row = await tx.messagingAccount.upsert({
          where: {
            orgId_channel_provider: {
              orgId: user.orgId,
              channel: data.channel,
              provider: data.provider,
            },
          },
          create: {
            orgId: user.orgId,
            channel: data.channel,
            provider: data.provider,
            mode: data.mode,
            config: {}, // secrets live in the vault; config is populated at go-live
          },
          update: { mode: data.mode },
          select: { channel: true, provider: true, mode: true },
        });

        await writeAudit(tx, {
          action: "integration:set-messaging-mode",
          entityType: "MessagingAccount",
          entityId: `${user.orgId}:${data.channel}:${data.provider}`,
          orgId: user.orgId,
          before: before ? { mode: before.mode } : null,
          after: { provider: data.provider, mode: data.mode },
        });

        revalidatePath("/settings/integrations");
        return { channel: row.channel, provider: row.provider, mode: row.mode };
      }),
    );
  });
}
