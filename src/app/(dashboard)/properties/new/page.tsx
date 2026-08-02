import type { Metadata } from "next";
import { forbidden } from "next/navigation";
import { requirePermission } from "@/lib/auth/guard";
import { PropertyForm } from "@/features/properties/components/property-form";

export const metadata: Metadata = { title: "Add a property" };

/** 01 T-14 — create (AC-1/3, AC-9). */
export default async function NewPropertyPage() {
  const user = await requirePermission("property:manage");

  // AC-9: creating a property is org-scoped. A Manager holds property:manage
  // but is bounded to their assignments, so they must not reach this form —
  // and the server, not the hidden nav button, is what enforces that.
  if (user.propertyScope.kind !== "ALL_IN_ORG") forbidden();

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold tracking-tight">Add a property</h1>
      <PropertyForm />
    </div>
  );
}
