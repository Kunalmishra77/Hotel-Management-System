"use server";

/**
 * Accounting-sync actions — 22 T-8 (FR-7/8, AC-8/10/12).
 *
 * Thin boundary: validate → authorize (`integration:manage`, org-level, audited)
 * → work → typed Result. `configureAccounting` makes switching Tally↔Zoho or
 * going live a CONFIG change (a row on `AccountingConfig`), never a code change.
 * `retrySync` re-attempts a dead-lettered row on demand; it is idempotent, so a
 * row that already synced clears without creating a duplicate.
 *
 * `integration:manage` is the SAME permission that gates channels/booking-engine
 * config (user-roles.md) — reused, not a new permission. It is org-wide
 * (Administrator), so authorize is called with a null property scope.
 */
import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { authorize } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import { NotFoundError } from "@/lib/errors";
import { toResult, type Result } from "@/lib/result";
import { accountingDb, withAccountingContext } from "./internal";
import { resyncLog } from "./sync";
import { configureAccountingSchema, retrySyncSchema } from "./schema";

export type AccountingConfigResult = { provider: string; mode: string };

/** Configure / switch the accounting provider + mode (config not code). FR-7/8. */
export async function configureAccounting(input: unknown): Promise<Result<AccountingConfigResult>> {
  return toResult(async () => {
    const data = configureAccountingSchema.parse(input);
    const user = await requireUser();
    authorize(user, "integration:manage", null); // org-level; deny non-admins (AC-12)
    const prisma = accountingDb();

    return withAccountingContext(user, () =>
      prisma.$transaction(async (tx) => {
        const cfg = await tx.accountingConfig.upsert({
          where: { orgId_provider: { orgId: user.orgId, provider: data.provider } },
          create: {
            orgId: user.orgId,
            provider: data.provider,
            mode: data.mode,
            credentialsRef: data.credentialsRef ?? null,
            glMappings: data.glMappings ? (data.glMappings as Prisma.InputJsonValue) : Prisma.JsonNull,
          },
          update: {
            mode: data.mode,
            ...(data.credentialsRef !== undefined ? { credentialsRef: data.credentialsRef } : {}),
            ...(data.glMappings !== undefined
              ? { glMappings: data.glMappings as Prisma.InputJsonValue }
              : {}),
          },
          select: { provider: true, mode: true },
        });

        await writeAudit(tx, {
          action: "integration:configure-accounting",
          entityType: "AccountingConfig",
          entityId: `${user.orgId}:${data.provider}`,
          orgId: user.orgId,
          after: { provider: data.provider, mode: data.mode },
        });
        revalidatePath("/accounting");
        return cfg;
      }),
    );
  });
}

export type RetrySyncResult = { status: string; externalId: string | null };

/** Retry one dead-lettered sync row (AC-10). Idempotent — never a duplicate. */
export async function retrySync(input: unknown): Promise<Result<RetrySyncResult>> {
  return toResult(async () => {
    const { logId } = retrySyncSchema.parse(input);
    const user = await requireUser();
    authorize(user, "integration:manage", null); // AC-12
    const prisma = accountingDb();

    const row = await prisma.accountingSyncLog.findUnique({ where: { id: logId }, select: { id: true } });
    if (!row) throw new NotFoundError("Sync record not found.");

    return withAccountingContext(user, async () => {
      const outcome = await resyncLog(prisma, user.orgId, logId);
      revalidatePath("/accounting");
      return {
        status: outcome.status,
        externalId: outcome.ok ? outcome.externalId : null,
      };
    });
  });
}
