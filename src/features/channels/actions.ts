"use server";

/**
 * Channel management actions — 13 T-8/T-9 (FR-1/4/16/17, AC-1/2/3/16).
 *
 * Thin boundary: validate → authorize (`integration:manage`, property-scoped,
 * audited) → transaction → event/audit → typed Result. `activateChannel` is
 * gated on certification (`CHANNEL_NOT_CERTIFIED`) — no code path makes an
 * uncertified channel go live (integrations.md honesty rule).
 */
import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { authorize } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import { ConflictError, DomainError, ErrorCode, NotFoundError } from "@/lib/errors";
import { toResult, type Result } from "@/lib/result";
import { newRequestId, runWithContext } from "@/lib/context";
import type { SessionClaims } from "@/lib/auth/claims";
import { channelDb, SyncStatus } from "./internal";
import {
  activateChannelSchema,
  certifyChannelSchema,
  connectChannelSchema,
  mapRoomTypeSchema,
  resolveAttentionSchema,
} from "./schema";

function withChannelContext<T>(user: SessionClaims, fn: () => Promise<T>): Promise<T> {
  return runWithContext(
    {
      orgId: user.orgId,
      userId: user.userId,
      propertyScope: user.propertyScope,
      activePropertyId: user.activePropertyId,
      requestId: newRequestId(),
      ip: null,
      device: null,
    },
    fn,
  );
}

export type ChannelAccountSummary = {
  id: string;
  propertyId: string;
  provider: string;
  isActive: boolean;
  certified: boolean;
};

/** Connect a channel for a property — always sandbox/inactive at first (FR-1). */
export async function connectChannel(input: unknown): Promise<Result<ChannelAccountSummary>> {
  return toResult(async () => {
    const data = connectChannelSchema.parse(input);
    const user = await requireUser();
    authorize(user, "integration:manage", data.propertyId);
    const client = channelDb(user);

    return withChannelContext(user, () =>
      client.$transaction(async (tx) => {
        let account;
        try {
          account = await tx.channelAccount.create({
            data: {
              propertyId: data.propertyId,
              provider: data.provider,
              isActive: false,
              config: data.config as Prisma.InputJsonValue,
            },
            select: { id: true, propertyId: true, provider: true, isActive: true, certifiedAt: true },
          });
        } catch (e) {
          if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
            throw new ConflictError("This channel is already connected for this property.");
          }
          throw e;
        }

        // Connect/activate are config acts, not sync events — audit records them;
        // no domain event is emitted (the catalog's ChannelPushed is for real
        // outbound pushes only, consumed by analytics/comms).
        await writeAudit(tx, {
          action: "integration:connect-channel",
          entityType: "ChannelAccount",
          entityId: account.id,
          propertyId: data.propertyId,
          after: { provider: data.provider, isActive: false },
        });

        revalidatePath("/channels");
        return {
          id: account.id,
          propertyId: account.propertyId,
          provider: account.provider,
          isActive: account.isActive,
          certified: account.certifiedAt != null,
        };
      }),
    );
  });
}

/** Map an external room type → an internal category for a channel (FR-4). */
export async function mapRoomType(input: unknown): Promise<Result<{ id: string }>> {
  return toResult(async () => {
    const data = mapRoomTypeSchema.parse(input);
    const user = await requireUser();
    const client = channelDb(user);

    const account = await client.channelAccount.findFirst({
      where: { id: data.channelAccountId },
      select: { id: true, propertyId: true },
    });
    if (!account) throw new NotFoundError("Channel account not found.");
    authorize(user, "integration:manage", account.propertyId);

    return withChannelContext(user, () =>
      client.$transaction(async (tx) => {
        const mapping = await tx.roomTypeMapping.upsert({
          where: {
            channelAccountId_externalRoomType: {
              channelAccountId: data.channelAccountId,
              externalRoomType: data.externalRoomType,
            },
          },
          create: {
            channelAccountId: data.channelAccountId,
            roomCategoryId: data.roomCategoryId,
            externalRoomType: data.externalRoomType,
            externalRatePlan: data.externalRatePlan ?? null,
          },
          update: {
            roomCategoryId: data.roomCategoryId,
            externalRatePlan: data.externalRatePlan ?? null,
          },
          select: { id: true },
        });
        await writeAudit(tx, {
          action: "integration:map-room-type",
          entityType: "RoomTypeMapping",
          entityId: mapping.id,
          propertyId: account.propertyId,
          after: { externalRoomType: data.externalRoomType, roomCategoryId: data.roomCategoryId },
        });
        revalidatePath("/channels");
        return mapping;
      }),
    );
  });
}

/**
 * Record certification credentials for a channel (a client/business step).
 * Sets `certifiedAt` + `credentialsRef` but does NOT go live — activation is a
 * separate, explicit act (FR-17).
 */
export async function certifyChannel(input: unknown): Promise<Result<{ id: string }>> {
  return toResult(async () => {
    const data = certifyChannelSchema.parse(input);
    const user = await requireUser();
    const client = channelDb(user);
    const account = await client.channelAccount.findFirst({
      where: { id: data.channelAccountId },
      select: { id: true, propertyId: true },
    });
    if (!account) throw new NotFoundError("Channel account not found.");
    authorize(user, "integration:manage", account.propertyId);

    return withChannelContext(user, () =>
      client.$transaction(async (tx) => {
        await tx.channelAccount.updateMany({
          where: { id: account.id },
          data: { certifiedAt: new Date(), credentialsRef: data.credentialsRef },
        });
        await writeAudit(tx, {
          action: "integration:certify-channel",
          entityType: "ChannelAccount",
          entityId: account.id,
          propertyId: account.propertyId,
          after: { certified: true },
        });
        revalidatePath("/channels");
        return { id: account.id };
      }),
    );
  });
}

/**
 * Clear a needs-attention row after an operator has resolved the underlying
 * oversell (re-roomed or cancelled via 03). Flips its status OK so it leaves the
 * queue (design § Needs-attention persistence). Property-scoped + audited.
 */
export async function resolveAttention(input: unknown): Promise<Result<{ id: string }>> {
  return toResult(async () => {
    const data = resolveAttentionSchema.parse(input);
    const user = await requireUser();
    const client = channelDb(user);

    const row = await client.channelSyncLog.findFirst({
      where: { id: data.syncLogId, status: SyncStatus.NEEDS_ATTENTION },
      select: { id: true, channelAccount: { select: { propertyId: true } } },
    });
    if (!row) throw new NotFoundError("Needs-attention item not found.");
    authorize(user, "reservation:modify", row.channelAccount.propertyId);

    return withChannelContext(user, () =>
      client.$transaction(async (tx) => {
        await tx.channelSyncLog.updateMany({
          where: { id: row.id, status: SyncStatus.NEEDS_ATTENTION },
          data: { status: SyncStatus.OK },
        });
        await writeAudit(tx, {
          action: "integration:resolve-attention",
          entityType: "ChannelSyncLog",
          entityId: row.id,
          propertyId: row.channelAccount.propertyId,
          after: { status: SyncStatus.OK },
        });
        revalidatePath("/channels");
        return { id: row.id };
      }),
    );
  });
}

/** Go live — refused unless the channel is certified with credentials (FR-17). */
export async function activateChannel(input: unknown): Promise<Result<ChannelAccountSummary>> {
  return toResult(async () => {
    const data = activateChannelSchema.parse(input);
    const user = await requireUser();
    const client = channelDb(user);

    const account = await client.channelAccount.findFirst({
      where: { id: data.channelAccountId },
      select: { id: true, propertyId: true, provider: true, certifiedAt: true, credentialsRef: true },
    });
    if (!account) throw new NotFoundError("Channel account not found.");
    authorize(user, "integration:manage", account.propertyId);

    const credentialsRef = data.credentialsRef ?? account.credentialsRef;
    // No certification (certifiedAt + a credentials reference) ⇒ stays sandbox.
    if (!account.certifiedAt || !credentialsRef) {
      throw new DomainError(ErrorCode.CHANNEL_NOT_CERTIFIED);
    }

    return withChannelContext(user, () =>
      client.$transaction(async (tx) => {
        await tx.channelAccount.updateMany({
          where: { id: account.id },
          data: { isActive: true, credentialsRef },
        });
        await writeAudit(tx, {
          action: "integration:activate-channel",
          entityType: "ChannelAccount",
          entityId: account.id,
          propertyId: account.propertyId,
          after: { isActive: true },
        });
        revalidatePath("/channels");
        return {
          id: account.id,
          propertyId: account.propertyId,
          provider: account.provider,
          isActive: true,
          certified: true,
        };
      }),
    );
  });
}
