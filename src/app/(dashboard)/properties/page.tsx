import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/guard";
import { propertyOverview } from "@/features/properties/queries";
import { PropertyOverview } from "@/features/properties/components/property-overview";

export const metadata: Metadata = { title: "Properties" };

/** 01 T-13 — the multi-property overview (FR-6/FR-8, AC-6/AC-8). */
export default async function PropertiesPage() {
  // Every role that can see a property list holds room:view-status; the list
  // itself is then scoped to the caller's assignments by the query (FR-8).
  const user = await requirePermission("room:view-status");
  const properties = await propertyOverview(user);

  return <PropertyOverview properties={properties} user={user} />;
}
