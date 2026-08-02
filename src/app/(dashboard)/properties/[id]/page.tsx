import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil } from "lucide-react";
import { requirePermission } from "@/lib/auth/guard";
import { can } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getProperty, listFloors, propertyOverview } from "@/features/properties/queries";
import { FloorsManager } from "@/features/properties/components/floors-manager";
import {
  OccupancyBar,
  OccupancyCounts,
} from "@/features/properties/components/occupancy-bar";

export const metadata: Metadata = { title: "Property" };

/** 01 — property detail: identity, live occupancy, floors (AC-4/AC-6). */
export default async function PropertyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // Scope is enforced here; getProperty would also throw OUT_OF_SCOPE.
  const user = await requirePermission("room:view-status", id);

  const property = await getProperty(user, id);
  if (!property) notFound();

  const [floors, overview] = await Promise.all([
    listFloors(user, id),
    propertyOverview(user),
  ]);
  const occupancy = overview.find((p) => p.id === id)?.occupancy;
  const mayManage = can(user, "property:manage", id);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold tracking-tight">{property.name}</h1>
          <p className="text-sm text-muted-foreground">
            {property.code} · {property.city}, {property.state}
            {!property.isActive && " · inactive"}
          </p>
        </div>
        {mayManage && (
          <Button asChild variant="outline" size="sm">
            <Link href={`/properties/${id}/edit`}>
              <Pencil className="size-4" />
              Edit
            </Link>
          </Button>
        )}
      </div>

      {occupancy && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Live occupancy</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <OccupancyBar occupancy={occupancy} />
            <OccupancyCounts occupancy={occupancy} />
          </CardContent>
        </Card>
      )}

      <FloorsManager propertyId={id} floors={floors} canManage={mayManage} />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Details</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <Detail label="Timezone" value={property.timezone} />
            <Detail label="GSTIN" value={property.gstin ?? "Not registered"} />
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
