/**
 * Channel queries — 13 T-20/T-21 (FR-19, AC-15). Property-scoped reads for the
 * channels list + per-channel health (connected state, last sync, pending +
 * dead-lettered counts) and the needs-attention queue (oversell items). Callers
 * pass claims explicitly (as in 01/02/03).
 */
import { db } from "@/lib/db";
import type { SessionClaims } from "@/lib/auth/claims";
import { SyncDirection, SyncStatus } from "./internal";

export type ChannelHealth = {
  id: string;
  provider: string;
  isActive: boolean;
  certified: boolean;
  lastSyncAt: Date | null;
  mappingCount: number;
  pendingCount: number;
  deadLetterCount: number;
  needsAttentionCount: number;
};

export async function channelHealth(
  user: SessionClaims,
  propertyId: string,
): Promise<ChannelHealth[]> {
  const accounts = await db.scoped(user).channelAccount.findMany({
    where: { propertyId },
    select: {
      id: true,
      provider: true,
      isActive: true,
      certifiedAt: true,
      lastSyncAt: true,
      _count: { select: { mappings: true } },
    },
    orderBy: { provider: "asc" },
  });
  if (accounts.length === 0) return [];

  const ids = accounts.map((a) => a.id);
  const prisma = db.unscoped();
  const grouped = await prisma.channelSyncLog.groupBy({
    by: ["channelAccountId", "status"],
    where: { channelAccountId: { in: ids } },
    _count: { _all: true },
  });

  const countFor = (accountId: string, status: string): number =>
    grouped.find((g) => g.channelAccountId === accountId && g.status === status)?._count._all ?? 0;

  return accounts.map((a) => ({
    id: a.id,
    provider: a.provider,
    isActive: a.isActive,
    certified: a.certifiedAt != null,
    lastSyncAt: a.lastSyncAt,
    mappingCount: a._count.mappings,
    pendingCount: countFor(a.id, SyncStatus.PENDING) + countFor(a.id, SyncStatus.FAILED),
    deadLetterCount: countFor(a.id, SyncStatus.DEAD_LETTER),
    needsAttentionCount: countFor(a.id, SyncStatus.NEEDS_ATTENTION),
  }));
}

export type MappingRow = {
  id: string;
  externalRoomType: string;
  externalRatePlan: string | null;
  roomCategoryId: string;
};

export async function listMappings(
  user: SessionClaims,
  channelAccountId: string,
): Promise<MappingRow[]> {
  // Confirm the account is in scope, then read its mappings.
  const account = await db.scoped(user).channelAccount.findFirst({
    where: { id: channelAccountId },
    select: { id: true },
  });
  if (!account) return [];
  return db.unscoped().roomTypeMapping.findMany({
    where: { channelAccountId },
    select: { id: true, externalRoomType: true, externalRatePlan: true, roomCategoryId: true },
    orderBy: { externalRoomType: "asc" },
  });
}

export type AttentionItem = {
  id: string;
  provider: string;
  externalId: string | null;
  reason: string | null;
  createdAt: Date;
};

/** The needs-attention (oversell) queue for a property (design § Overbooking safety). */
export async function needsAttentionQueue(
  user: SessionClaims,
  propertyId: string,
): Promise<AttentionItem[]> {
  const accounts = await db.scoped(user).channelAccount.findMany({
    where: { propertyId },
    select: { id: true, provider: true },
  });
  if (accounts.length === 0) return [];
  const providerById = new Map(accounts.map((a) => [a.id, a.provider]));

  const rows = await db.unscoped().channelSyncLog.findMany({
    where: {
      channelAccountId: { in: accounts.map((a) => a.id) },
      direction: SyncDirection.IN,
      status: SyncStatus.NEEDS_ATTENTION,
    },
    select: { id: true, channelAccountId: true, externalId: true, error: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return rows.map((r) => ({
    id: r.id,
    provider: providerById.get(r.channelAccountId) ?? "unknown",
    externalId: r.externalId,
    reason: r.error,
    createdAt: r.createdAt,
  }));
}
