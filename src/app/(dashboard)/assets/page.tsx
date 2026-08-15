import type { Metadata } from "next";
import { HardDrive, MapPin, ShieldCheck } from "lucide-react";
import { requirePermission } from "@/lib/auth/guard";
import { listAssets } from "@/features/assets/queries";
import { AssetForm } from "@/features/assets/components/asset-form";
import { AssetStatus } from "@/features/assets/components/asset-status";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Assets & equipment" };

const day = (d: Date): string => new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

/**
 * Maintenance · Assets & Equipment (architecture v2 · Phase 5). The property's
 * physical-asset registry — AC, TV, generator… — with warranty + operational
 * status. `maintenance:manage`.
 */
export default async function AssetsPage() {
  const user = await requirePermission("maintenance:manage");
  const propertyId = user.activePropertyId ?? user.accessiblePropertyIds[0] ?? null;
  const assets = propertyId ? await listAssets(user, propertyId) : [];

  return (
    <div className="mx-auto w-full max-w-3xl px-1 py-1">
      <PageHeader title="Assets & equipment" description={`${assets.length} asset${assets.length === 1 ? "" : "s"} on record.`} actions={<AssetForm />} />

      {assets.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed bg-muted/30 p-10 text-center">
          <HardDrive className="mx-auto size-6 text-muted-foreground" aria-hidden="true" />
          <p className="mt-3 text-sm font-medium">No assets yet</p>
          <p className="mt-1 text-sm text-muted-foreground">Register the property&apos;s equipment to track warranty and repairs.</p>
        </div>
      ) : (
        <ul className="mt-6 space-y-2.5">
          {assets.map((a) => (
            <li key={a.id}>
              <Card className="flex items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{a.name}</span>
                    <span className="rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">{a.category}</span>
                  </div>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-sm text-muted-foreground">
                    {a.location ? <span className="inline-flex items-center gap-1"><MapPin className="size-3.5" aria-hidden="true" />{a.location}</span> : null}
                    {a.warrantyUntil ? <span className="inline-flex items-center gap-1"><ShieldCheck className="size-3.5" aria-hidden="true" />warranty {day(a.warrantyUntil)}</span> : null}
                  </p>
                </div>
                <AssetStatus assetId={a.id} status={a.status} />
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
