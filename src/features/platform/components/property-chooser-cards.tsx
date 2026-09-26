"use client";

/**
 * Property chooser — the "pick which hotel" step for per-property pages when the
 * user is in "All hotels" mode. Replaces the old "Create a property" dead-end: a
 * group admin defaults to All hotels, so a per-property page (Rooms, Housekeeping,
 * Payroll…) shows the 4 properties as rich cards to drill into. Clicking a card
 * scopes the whole app to that property and re-renders the page in context.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Building2, BedDouble, DoorOpen, Wrench, ArrowRight } from "lucide-react";
import { switchProperty } from "../actions";

export type ChooserProperty = {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  total: number;
  occupied: number;
  available: number;
  maintenance: number;
  occupancyPct: number;
};

export function PropertyChooserCards({ properties, what }: { properties: ChooserProperty[]; what: string }) {
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
      <div className="mb-4">
        <h2 className="text-lg font-semibold tracking-tight">Choose a property</h2>
        <p className="text-sm text-muted-foreground">Pick a hotel to view its {what}. You can switch anytime from the selector at the top.</p>
      </div>
      {error && <p role="alert" className="mb-3 text-sm text-destructive">{error}</p>}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {properties.map((p) => {
          const busy = pendingId === p.id;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => pick(p.id)}
              disabled={pendingId !== null}
              data-testid={`choose-property-${p.id}`}
              className="group flex flex-col overflow-hidden rounded-2xl border bg-card text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
            >
              {/* Header band (no photo field yet — a clean branded gradient + initial). */}
              <div className="relative flex h-24 items-end bg-gradient-to-br from-primary/85 to-primary/60 p-4">
                <Building2 className="absolute right-3 top-3 size-8 text-primary-foreground/30" aria-hidden="true" />
                <div className="flex size-11 items-center justify-center rounded-xl bg-background/95 text-lg font-bold text-primary shadow">
                  {p.name.replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase()}
                </div>
              </div>
              <div className="flex flex-1 flex-col gap-3 p-4">
                <div>
                  <p className="font-semibold leading-tight">{p.name}</p>
                  <p className="text-xs text-muted-foreground">{[p.city, p.state].filter(Boolean).join(", ") || "—"}</p>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <Stat icon={<BedDouble />} label="Rooms" value={p.total} />
                  <Stat icon={<DoorOpen />} label="Occupied" value={p.occupied} tone="warn" />
                  <Stat icon={<BedDouble />} label="Available" value={p.available} tone="good" />
                </div>
                <div>
                  <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                    <span>Occupancy</span><span className="tabular font-medium text-foreground">{p.occupancyPct}%</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, p.occupancyPct)}%` }} />
                  </div>
                  {p.maintenance > 0 && (
                    <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-amber-600"><Wrench className="size-3" /> {p.maintenance} under maintenance</p>
                  )}
                </div>
                <span className="mt-auto inline-flex items-center gap-1 text-sm font-medium text-primary">
                  {busy ? "Opening…" : <>View {what} <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" /></>}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Stat({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: number; tone?: "good" | "warn" }) {
  const color = tone === "good" ? "text-success" : tone === "warn" ? "text-amber-600" : "text-foreground";
  return (
    <div className="rounded-lg border bg-muted/30 py-2">
      <div className={`flex items-center justify-center gap-1 text-base font-semibold tabular ${color} [&_svg]:size-3.5 [&_svg]:text-muted-foreground`}>{icon}{value}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}
