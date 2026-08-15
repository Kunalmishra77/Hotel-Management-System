import "server-only";
/**
 * Assets & equipment reads (architecture v2 · Phase 5). Property-scoped registry
 * for the maintenance team. `maintenance:manage`.
 */
import { db } from "@/lib/db";
import type { SessionClaims } from "@/lib/auth/claims";

export type AssetItem = {
  id: string;
  name: string;
  category: string;
  location: string | null;
  serialNo: string | null;
  warrantyUntil: Date | null;
  status: string;
  notes: string | null;
};

export async function listAssets(user: SessionClaims, propertyId: string): Promise<AssetItem[]> {
  const rows = await db.scoped(user).asset.findMany({
    where: { propertyId },
    orderBy: [{ category: "asc" }, { name: "asc" }],
    take: 300,
    select: { id: true, name: true, category: true, location: true, serialNo: true, warrantyUntil: true, status: true, notes: true },
  });
  return rows;
}
