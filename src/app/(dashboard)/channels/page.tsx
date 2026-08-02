import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { channelHealth, needsAttentionQueue, listMappings } from "@/features/channels/queries";
import { ChannelsView } from "@/features/channels/components/channels-view";

export const metadata: Metadata = { title: "Channels" };

/** 13 T-20/T-21 — channels list + health + room-type mapping + needs-attention. */
export default async function ChannelsPage() {
  const user = await requirePermission("integration:manage");
  const propertyId = user.activePropertyId;
  if (!propertyId) {
    return (
      <div className="p-4">
        <p className="text-sm text-muted-foreground">Select a property to manage channels.</p>
      </div>
    );
  }

  const [health, attention, categories] = await Promise.all([
    channelHealth(user, propertyId),
    needsAttentionQueue(user, propertyId),
    db.scoped(user).roomCategory.findMany({
      where: { propertyId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  // Mappings for each connected channel (small N — one query per account).
  const mappingsByAccount = Object.fromEntries(
    await Promise.all(
      health.map(async (h) => [h.id, await listMappings(user, h.id)] as const),
    ),
  );

  return (
    <ChannelsView
      propertyId={propertyId}
      health={health}
      attention={attention}
      categories={categories}
      mappingsByAccount={mappingsByAccount}
    />
  );
}
