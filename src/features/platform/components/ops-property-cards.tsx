"use client";

/**
 * Ops property chooser (Phase-3 ⑨) — the all-hotels landing for a per-property
 * operational board (Housekeeping, Maintenance). One card per property showing its
 * own pending-work counts, so you see where attention is needed before drilling in.
 * Clicking a card scopes the app to that property and re-renders the board in
 * context. Generic: the caller supplies the stat pairs and the "view X" verb.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { switchProperty } from "../actions";

export type OpsStat = { label: string; value: number; tone?: "good" | "warn" | "bad" };
export type OpsPropertyCard = { propertyId: string; propertyName: string; stats: OpsStat[] };

const TONE: Record<string, string> = {
  good: "text-success",
  warn: "text-amber-600",
  bad: "text-destructive",
};

export function OpsPropertyCards({ cards, what }: { cards: OpsPropertyCard[]; what: string }) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const pick = (id: string) => {
    setError(null);
    setPendingId(id);
    start(async () => {
      const res = await switchProperty({ propertyId: id });
      if (res.ok) router.refresh();
      else { setError(res.error.message); setPendingId(null); }
    });
  };

  return (
    <div>
      {error && <p role="alert" className="mb-3 text-sm text-destructive">{error}</p>}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((c) => {
          const busy = pendingId === c.propertyId;
          return (
            <button
              key={c.propertyId}
              type="button"
              onClick={() => pick(c.propertyId)}
              disabled={pendingId !== null}
              data-testid={`ops-property-${c.propertyId}`}
              className="group flex flex-col gap-3 rounded-2xl border bg-card p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
            >
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-sm font-bold text-primary">
                  {c.propertyName.replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase()}
                </div>
                <p className="font-semibold leading-tight">{c.propertyName}</p>
              </div>
              <div className={`grid gap-2 text-center`} style={{ gridTemplateColumns: `repeat(${c.stats.length}, minmax(0, 1fr))` }}>
                {c.stats.map((s) => (
                  <div key={s.label} className="rounded-lg border bg-muted/30 py-2">
                    <div className={`text-base font-semibold tabular ${s.tone ? TONE[s.tone] : "text-foreground"}`}>{s.value}</div>
                    <div className="text-[11px] text-muted-foreground">{s.label}</div>
                  </div>
                ))}
              </div>
              <span className="mt-auto inline-flex items-center gap-1 text-sm font-medium text-primary">
                {busy ? "Opening…" : <>View {what} <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" /></>}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
