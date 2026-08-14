import type { Metadata } from "next";
import { Sparkles } from "lucide-react";
import { requirePermission } from "@/lib/auth/guard";
import { PageHeader } from "@/components/ui/page-header";
import { listPendingAddOnRequests } from "@/features/add-ons/queries";
import { AddOnDecideControls } from "@/features/add-ons/components/add-on-decide-controls";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Add-on requests" };

const rupees = (paise: number): string =>
  `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

const since = (d: Date): string => {
  const mins = Math.round((Date.now() - new Date(d).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  return hrs < 24 ? `${hrs}h ago` : `${Math.round(hrs / 24)}d ago`;
};

export default async function AddOnRequestsPage() {
  await requirePermission("folio:charge");
  const requests = await listPendingAddOnRequests();

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6">
      <PageHeader title="Add-on requests" description="Extras guests asked for. Accepting adds the charge to their folio." />

      {requests.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed bg-muted/30 p-10 text-center">
          <Sparkles className="mx-auto size-6 text-muted-foreground" aria-hidden="true" />
          <p className="mt-3 text-sm font-medium">No pending requests</p>
          <p className="mt-1 text-sm text-muted-foreground">Guest add-on requests will appear here.</p>
        </div>
      ) : (
        <ul className="mt-6 space-y-3">
          {requests.map((r) => (
            <li key={r.id} className="rounded-xl border bg-card p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{r.name}</span>
                    {r.quantity > 1 ? <span className="text-sm text-muted-foreground">× {r.quantity}</span> : null}
                    <span className="text-xs text-muted-foreground">{since(r.requestedAt)}</span>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {r.guestName} · {r.reservationCode}
                    {!r.chargeable ? (
                      <span className="ml-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-400">
                        awaiting check-in
                      </span>
                    ) : null}
                  </p>
                  {r.note ? <p className="mt-1 text-sm italic text-muted-foreground">“{r.note}”</p> : null}
                </div>
                <span className="shrink-0 text-sm font-semibold tabular">{rupees(r.unitPaise * r.quantity)}</span>
              </div>
              <div className="mt-3 border-t pt-3">
                <AddOnDecideControls id={r.id} chargeable={r.chargeable} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
