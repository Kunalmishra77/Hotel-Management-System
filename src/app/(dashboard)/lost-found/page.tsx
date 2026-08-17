import type { Metadata } from "next";
import { PackageSearch, MapPin } from "lucide-react";
import { requirePermission } from "@/lib/auth/guard";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { KpiCard } from "@/components/ui/kpi-card";
import { listLostAndFound } from "@/features/lost-found/queries";
import { LostFoundForm } from "@/features/lost-found/components/lost-found-form";
import { ResolveLostItem } from "@/features/lost-found/components/resolve-lost-item";
import { LOST_FOUND_STATUS_LABEL, isResolvable, type LostFoundStatus } from "@/features/lost-found/domain/status";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Lost & Found" };

const day = (d: Date): string => new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "STORED"
      ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
      : status === "CLAIMED"
        ? "bg-success/10 text-success"
        : "bg-muted text-muted-foreground";
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>
      {LOST_FOUND_STATUS_LABEL[status as LostFoundStatus] ?? status}
    </span>
  );
}

export default async function LostFoundPage() {
  await requirePermission("housekeeping:update");
  const items = await listLostAndFound();

  const stored = items.filter((i) => i.status === "STORED").length;
  const claimed = items.filter((i) => i.status === "CLAIMED").length;

  return (
    <div className="mx-auto grid w-full max-w-5xl gap-4 px-4 py-6 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <PageHeader title="Lost & Found" description="Items guests left behind — logged, then claimed or disposed." />
        <div className="mt-4 grid grid-cols-3 gap-3">
          <KpiCard label="Logged" value={items.length} icon={<PackageSearch />} hint="All items" />
          <KpiCard label="Stored" value={stored} icon={<MapPin />} hint="Unclaimed" className={stored > 0 ? "border-warning/40" : undefined} />
          <KpiCard label="Claimed" value={claimed} icon={<PackageSearch />} hint="Collected" />
        </div>
        {items.length === 0 ? (
          <div className="mt-6 rounded-xl border border-dashed bg-muted/30 p-10 text-center">
            <PackageSearch className="mx-auto size-6 text-muted-foreground" aria-hidden="true" />
            <p className="mt-3 text-sm font-medium">Nothing logged yet</p>
            <p className="mt-1 text-sm text-muted-foreground">Log a found item using the form.</p>
          </div>
        ) : (
          <ul className="mt-4 space-y-3">
            {items.map((it) => (
              <li key={it.id} className="rounded-xl border bg-card p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{it.description}</span>
                      <StatusBadge status={it.status} />
                    </div>
                    <p className="mt-1 inline-flex items-center gap-2 text-xs text-muted-foreground">
                      {it.roomNumber && (
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="size-3" aria-hidden="true" /> Room {it.roomNumber}
                        </span>
                      )}
                      <span>Found {day(it.foundOn)}</span>
                      {it.claimantName && <span>· Collected by {it.claimantName}</span>}
                    </p>
                    {it.notes && <p className="mt-1 text-xs text-muted-foreground">{it.notes}</p>}
                  </div>
                </div>
                {isResolvable(it.status) && (
                  <div className="mt-3 border-t pt-3">
                    <ResolveLostItem id={it.id} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="lg:col-span-1">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Log a found item</CardTitle>
          </CardHeader>
          <CardContent>
            <LostFoundForm />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
