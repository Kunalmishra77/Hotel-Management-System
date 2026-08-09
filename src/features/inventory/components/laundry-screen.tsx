"use client";

/**
 * 20 addendum — laundry reconciliation UI (FR-8/9). Create a batch of linen sent
 * out (per-line quantity + tolerance), then record what came back; each line
 * shows the balance and an OK / SHORT / pending badge. Mobile-first.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { createLaundryBatch, recordLaundryReturns } from "../laundry-actions";
import type { LaundryBatchView } from "../queries";

const today = () => new Date().toISOString().slice(0, 10);
type NewLine = { itemName: string; sentQty: number; toleranceQty: number };

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "SHORT" ? "bg-destructive/12 text-destructive"
    : status === "OK" ? "bg-success/12 text-success"
    : "bg-muted text-muted-foreground";
  const label = status === "SHORT" ? "Short" : status === "OK" ? "OK" : "Pending";
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{label}</span>;
}

export function LaundryScreen({ propertyId, batches }: { propertyId: string; batches: LaundryBatchView[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [sentOn, setSentOn] = useState(today());
  const [vendor, setVendor] = useState("");
  const [lines, setLines] = useState<NewLine[]>([{ itemName: "", sentQty: 0, toleranceQty: 0 }]);
  const [returns, setReturns] = useState<Record<string, number>>({});

  const setLine = (i: number, patch: Partial<NewLine>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  function create() {
    const items = lines.filter((l) => l.itemName.trim() && l.sentQty > 0);
    if (items.length === 0) return toast.error("Add at least one line with a quantity.");
    start(async () => {
      const res = await createLaundryBatch({ propertyId, sentOn, vendor: vendor.trim() || undefined, items });
      if (res.ok) {
        toast.success("Laundry batch created.");
        setLines([{ itemName: "", sentQty: 0, toleranceQty: 0 }]);
        setVendor("");
        router.refresh();
      } else toast.error(res.error.message);
    });
  }

  function recordReturns(batch: LaundryBatchView) {
    const rows = batch.items
      .filter((it) => returns[it.id] !== undefined)
      .map((it) => ({ itemId: it.id, returnedQty: returns[it.id] ?? 0 }));
    if (rows.length === 0) return toast.error("Enter returned quantities first.");
    start(async () => {
      const res = await recordLaundryReturns({ batchId: batch.id, returns: rows });
      if (res.ok) {
        toast.success("Returns recorded.");
        router.refresh();
      } else toast.error(res.error.message);
    });
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 p-4">
      <h1 className="text-xl font-semibold">Laundry</h1>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Send a batch</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5"><Label htmlFor="l-date">Sent on</Label><Input id="l-date" type="date" value={sentOn} onChange={(e) => setSentOn(e.target.value)} /></div>
            <div className="space-y-1.5"><Label htmlFor="l-vendor">Vendor (optional)</Label><Input id="l-vendor" value={vendor} onChange={(e) => setVendor(e.target.value)} /></div>
          </div>
          <div className="space-y-2" data-testid="batch-lines">
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-[1fr_5rem_5rem_auto] items-end gap-2">
                <div className="space-y-1"><Label className="text-xs">Item</Label><Input value={l.itemName} onChange={(e) => setLine(i, { itemName: e.target.value })} placeholder="Bedsheet" data-testid={`line-name-${i}`} /></div>
                <div className="space-y-1"><Label className="text-xs">Sent</Label><Input type="number" inputMode="numeric" value={l.sentQty} onChange={(e) => setLine(i, { sentQty: Number(e.target.value) })} data-testid={`line-sent-${i}`} /></div>
                <div className="space-y-1"><Label className="text-xs">Tol.</Label><Input type="number" inputMode="numeric" value={l.toleranceQty} onChange={(e) => setLine(i, { toleranceQty: Number(e.target.value) })} data-testid={`line-tol-${i}`} /></div>
                <Button type="button" variant="ghost" size="sm" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} aria-label="Remove line" disabled={lines.length === 1}><Trash2 className="size-4" /></Button>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" onClick={() => setLines((ls) => [...ls, { itemName: "", sentQty: 0, toleranceQty: 0 }])}><Plus className="size-4" /> Add line</Button>
          </div>
          <Button size="lg" onClick={create} disabled={pending} data-testid="batch-create">Send batch</Button>
        </CardContent>
      </Card>

      {batches.length === 0 ? (
        <EmptyState title="No laundry batches yet" description="Send a batch above to start tracking linen." />
      ) : (
        <ul className="space-y-3" data-testid="batch-list">
          {batches.map((b) => (
            <li key={b.id} className="rounded-lg border bg-card p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium">
                  {new Date(b.sentOn).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                  {b.vendor ? <span className="text-sm font-normal text-muted-foreground"> · {b.vendor}</span> : null}
                </p>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${b.status === "RECONCILED" ? "bg-success/12 text-success" : "bg-warning/12 text-warning"}`}>
                  {b.status === "RECONCILED" ? "Reconciled" : "Open"}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Sent {b.totals.sent} · Back {b.totals.returned} · Balance {b.totals.balance}
                {b.totals.anyShort ? <span className="ml-1 font-medium text-destructive">· shortage</span> : null}
              </p>

              <ul className="mt-3 divide-y rounded-md border">
                {b.items.map((it) => (
                  <li key={it.id} className="flex items-center justify-between gap-2 p-2.5 text-sm" data-testid={`bline-${it.id}`}>
                    <span className="min-w-0 truncate">{it.itemName} <span className="text-xs text-muted-foreground">· sent {it.sentQty}{it.toleranceQty ? ` ±${it.toleranceQty}` : ""}</span></span>
                    <div className="flex shrink-0 items-center gap-2">
                      {b.status === "RECONCILED" ? (
                        <span className="text-xs text-muted-foreground">back {it.returnedQty} · bal {it.balance}</span>
                      ) : (
                        <Input type="number" inputMode="numeric" className="h-9 w-20" aria-label={`Returned for ${it.itemName}`}
                          value={returns[it.id] ?? ""} placeholder="back"
                          onChange={(e) => setReturns((r) => ({ ...r, [it.id]: Number(e.target.value) }))}
                          data-testid={`return-${it.id}`} />
                      )}
                      <StatusBadge status={it.status} />
                    </div>
                  </li>
                ))}
              </ul>

              {b.status !== "RECONCILED" ? (
                <Button size="sm" className="mt-3" onClick={() => recordReturns(b)} disabled={pending} data-testid={`reconcile-${b.id}`}>Record returns</Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
