import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/guard";
import { getProperty } from "@/features/properties/queries";
import { PropertyForm } from "@/features/properties/components/property-form";

export const metadata: Metadata = { title: "Edit property" };

/** 01 T-14 — edit (AC-2/3). */
export default async function EditPropertyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // Scoped to this property: a Manager may edit their own, not another's.
  const user = await requirePermission("property:manage", id);

  const property = await getProperty(user, id);
  if (!property) notFound();

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold tracking-tight">Edit {property.name}</h1>
      <PropertyForm initial={property} />
    </div>
  );
}
