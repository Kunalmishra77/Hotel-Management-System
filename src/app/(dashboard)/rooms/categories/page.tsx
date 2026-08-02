import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/guard";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";
import { listCategories } from "@/features/rooms/queries";
import { listFloors } from "@/features/properties/queries";
import { CategoryManager } from "@/features/rooms/components/category-manager";

export const metadata: Metadata = { title: "Room categories" };

/** 02 T-16 — categories + quick room creation (AC-1/AC-2/AC-3). */
export default async function CategoriesPage() {
  // Viewing is open to anyone who works the board; creating needs room:manage,
  // which the manager flag below gates — and the action re-checks (AC-12).
  const user = await requirePermission("room:view-status");
  const propertyId = db.activeProperty(user);

  const [categories, floors] = await Promise.all([
    listCategories(user, propertyId),
    listFloors(user, propertyId),
  ]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Room categories</h1>
        <p className="text-sm text-muted-foreground">
          Tariff, occupancy limits and HSN/SAC per category.
        </p>
      </div>

      <CategoryManager
        propertyId={propertyId}
        categories={categories}
        floors={floors}
        canManage={can(user, "room:manage", propertyId)}
      />
    </div>
  );
}
