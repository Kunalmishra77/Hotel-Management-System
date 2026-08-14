import type { Metadata } from "next";
import { ConciergeBell } from "lucide-react";
import { requirePermission } from "@/lib/auth/guard";
import { PageHeader } from "@/components/ui/page-header";
import { listGuestRequests } from "@/features/guest-requests/queries";
import { RequestStatusControls } from "@/features/guest-requests/components/request-status-controls";
import { KIND_LABEL, REQUEST_STATUS_LABEL, isGuestRequestKind } from "@/features/guest-account/domain/request-kind";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Guest requests" };

const since = (d: Date): string => {
  const mins = Math.round((Date.now() - new Date(d).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  return hrs < 24 ? `${hrs}h ago` : `${Math.round(hrs / 24)}d ago`;
};

export default async function GuestRequestsPage() {
  await requirePermission("request:manage");
  const requests = await listGuestRequests();

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6">
      <PageHeader title="Guest requests" description="In-room service requests from checked-in guests." />

      {requests.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed bg-muted/30 p-10 text-center">
          <ConciergeBell className="mx-auto size-6 text-muted-foreground" aria-hidden="true" />
          <p className="mt-3 text-sm font-medium">No open requests</p>
          <p className="mt-1 text-sm text-muted-foreground">New in-room requests will appear here.</p>
        </div>
      ) : (
        <ul className="mt-6 space-y-3">
          {requests.map((r) => (
            <li key={r.id} className="rounded-xl border bg-card p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{isGuestRequestKind(r.kind) ? KIND_LABEL[r.kind] : r.kind}</span>
                    {r.roomNumber && (
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                        Room {r.roomNumber}
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground">{since(r.createdAt)}</span>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{r.detail}</p>
                </div>
                <span className="shrink-0 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-400">
                  {REQUEST_STATUS_LABEL[r.status] ?? r.status}
                </span>
              </div>
              <div className="mt-3 border-t pt-3">
                <RequestStatusControls id={r.id} status={r.status} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
