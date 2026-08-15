import type { Metadata } from "next";
import { ClipboardCheck, DoorClosed } from "lucide-react";
import { requirePermission } from "@/lib/auth/guard";
import { listInspectionQueue, listRecentInspections } from "@/features/inspections/queries";
import { InspectControl } from "@/features/inspections/components/inspect-control";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Room inspection" };

const when = (d: Date): string => new Date(d).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

/**
 * Housekeeping · Room Inspection (architecture v2 · Phase 5). Cleaned rooms
 * (HOUSEKEEPING status) await sign-off: PASS marks the room ready, FAIL sends it
 * back for a re-clean with a defect note. `housekeeping:update`.
 */
export default async function InspectionPage() {
  const user = await requirePermission("housekeeping:update");
  const propertyId = user.activePropertyId ?? user.accessiblePropertyIds[0] ?? null;
  const [queue, recent] = propertyId
    ? await Promise.all([listInspectionQueue(user, propertyId), listRecentInspections(user, propertyId)])
    : [[], []];

  return (
    <div className="mx-auto w-full max-w-3xl px-1 py-1">
      <PageHeader title="Room inspection" description={`${queue.length} room${queue.length === 1 ? "" : "s"} awaiting inspection.`} />

      {queue.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed bg-muted/30 p-10 text-center">
          <ClipboardCheck className="mx-auto size-6 text-muted-foreground" aria-hidden="true" />
          <p className="mt-3 text-sm font-medium">Nothing to inspect</p>
          <p className="mt-1 text-sm text-muted-foreground">Cleaned rooms awaiting sign-off appear here.</p>
        </div>
      ) : (
        <ul className="mt-6 space-y-2.5">
          {queue.map((r) => (
            <li key={r.roomId}>
              <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <span className="inline-flex items-center gap-2 font-semibold">
                  <DoorClosed className="size-4 text-muted-foreground" aria-hidden="true" /> Room {r.number}
                </span>
                <InspectControl roomId={r.roomId} />
              </Card>
            </li>
          ))}
        </ul>
      )}

      {recent.length > 0 && (
        <Card className="mt-6">
          <CardHeader className="pb-2"><CardTitle className="text-base">Recent inspections</CardTitle></CardHeader>
          <CardContent>
            <ul className="divide-y">
              {recent.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="min-w-0">
                    <span className="font-medium">Room {r.roomNumber}</span>
                    {r.defectNotes ? <span className="ml-2 text-muted-foreground">· {r.defectNotes}</span> : null}
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="text-xs text-muted-foreground">{when(r.inspectedAt ?? r.createdAt)}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${r.status === "PASS" ? "bg-emerald-600/10 text-emerald-700 dark:text-emerald-400" : "bg-destructive/10 text-destructive"}`}>
                      {r.status}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
