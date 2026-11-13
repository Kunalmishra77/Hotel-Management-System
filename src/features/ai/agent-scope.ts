/**
 * The agent's view of "all properties". The org also has non-hotel cost-centres
 * (head office, A2 office, "Other") that hold expenses but no rooms or guests;
 * counting them made the agent say "all 7 properties" for 4 hotels (client
 * report, 13 Nov 2026). Guest/room answers use `hotelIds`; money answers keep
 * `ids` because centralized expenses are booked on the cost-centres.
 */
import { db } from "@/lib/db";
import type { SessionClaims } from "@/lib/auth/claims";

export type AgentScope = { ids: string[]; hotelIds: string[]; label: string };

export async function agentScope(user: SessionClaims): Promise<AgentScope> {
  const ids = user.activePropertyId ? [user.activePropertyId] : [...user.accessiblePropertyIds];
  const hotels = await db.scoped(user).property.findMany({
    where: { id: { in: ids }, isCostCenter: false },
    select: { id: true },
  });
  const hotelIds = hotels.map((h) => h.id);
  const label = user.activePropertyId
    ? "this property"
    : hotelIds.length === 1
      ? "your hotel"
      : `all ${hotelIds.length} hotels`;
  return { ids, hotelIds, label };
}
