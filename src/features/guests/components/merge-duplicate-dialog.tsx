"use client";

/**
 * Merge-duplicate dialog — wires the built `mergeGuests` action (04 T-11/FR-12)
 * into the guest profile. You search for the OTHER record (the duplicate), and
 * it is merged INTO the profile you're viewing (the survivor): its bookings,
 * IDs and feedback move here, and it is soft-deleted with merge lineage.
 *
 * Gated by `guest:merge` (the page only renders this when the user holds it; the
 * action re-checks server-side). Deliberately a manual picker, not auto-merge —
 * a wrong merge loses a guest's stay history, so a human confirms the pair.
 */
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Merge } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { findMergeCandidates, mergeGuests, type MergeCandidate } from "../merge-actions";

export function MergeDuplicateDialog({ survivorId, survivorName }: { survivorId: string; survivorName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<MergeCandidate[]>([]);
  const [searched, setSearched] = useState(false);
  const [selected, setSelected] = useState<MergeCandidate | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [searching, startSearch] = useTransition();
  const [merging, startMerge] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function reset() {
    setQuery(""); setCandidates([]); setSearched(false); setSelected(null); setReason(""); setError(null);
  }

  function onQueryChange(next: string) {
    setQuery(next);
    setSelected(null);
    if (timer.current) clearTimeout(timer.current);
    if (next.trim() === "") { setCandidates([]); setSearched(false); return; }
    timer.current = setTimeout(() => {
      startSearch(async () => {
        const res = await findMergeCandidates({ query: next, excludeId: survivorId });
        if (res.ok) { setCandidates(res.data); setSearched(true); }
        else setError(res.error?.message ?? "Search failed.");
      });
    }, 300);
  }

  function doMerge() {
    if (!selected) return;
    setError(null);
    startMerge(async () => {
      const res = await mergeGuests({ survivorId, loserId: selected.id, reason: reason.trim() || undefined });
      if (res.ok) { setOpen(false); reset(); router.refresh(); }
      else setError(res.error?.message ?? "Merge failed.");
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" data-testid="merge-duplicate-open"><Merge /> Merge duplicate</Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Merge a duplicate into this guest</DialogTitle>
          <DialogDescription>
            Find the other record for this person. It will be closed and its bookings, IDs and history moved into <span className="font-medium text-foreground">{survivorName}</span>. This can’t be undone from here.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="merge-search">Search for the duplicate</Label>
            <Input id="merge-search" type="search" inputMode="search" value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              placeholder="Name, mobile, email, company or GSTIN" data-testid="merge-search" autoFocus />
          </div>

          {searching && <p className="text-sm text-muted-foreground">Searching…</p>}

          {!searching && searched && candidates.length === 0 && (
            <p className="text-sm text-muted-foreground">No other guests match. The duplicate must already exist as a separate record.</p>
          )}

          {candidates.length > 0 && (
            <ul className="max-h-56 divide-y overflow-y-auto rounded-md border" data-testid="merge-candidates">
              {candidates.map((c) => {
                const picked = selected?.id === c.id;
                return (
                  <li key={c.id}>
                    <button type="button" onClick={() => setSelected(c)}
                      className={`flex w-full items-center justify-between gap-2 p-3 text-left text-sm hover:bg-muted/50 ${picked ? "bg-primary/10" : ""}`}
                      data-testid={`merge-candidate-${c.id}`}>
                      <span>
                        <span className="font-medium">{c.fullName}</span>
                        {c.companyName ? <span className="text-muted-foreground"> · {c.companyName}</span> : null}
                        <span className="block text-xs text-muted-foreground">{[c.maskedMobile, c.city].filter(Boolean).join(" · ") || "no contact on file"}</span>
                      </span>
                      {picked && <span className="shrink-0 text-xs font-medium text-primary">selected</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {selected && (
            <div className="space-y-1.5">
              <Label htmlFor="merge-reason">Reason (optional, audited)</Label>
              <Textarea id="merge-reason" value={reason} onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Same guest entered twice at check-in" rows={2} data-testid="merge-reason" />
            </div>
          )}

          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={merging}>Cancel</Button>
          <Button onClick={doMerge} disabled={!selected || merging} data-testid="merge-confirm">
            {merging ? "Merging…" : selected ? `Merge “${selected.fullName}” in` : "Select a duplicate"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
