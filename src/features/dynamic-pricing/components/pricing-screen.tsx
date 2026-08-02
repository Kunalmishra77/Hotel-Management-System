"use client";

/**
 * Pricing rate calendar — 24 T-9 (AC-1/2/3). Mobile-first: a per-date list of
 * suggestions with in-guardrail approve/adjust. RBAC + the guardrail are enforced
 * server-side; this UI only surfaces the result. Actions ≥44px for the thumb.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { approveRate, rejectRate } from "../actions";
import type { DynamicRateRow, CategoryGuardrail } from "../queries";

const rupees = (p: number) => `₹${(p / 100).toLocaleString("en-IN")}`;
const toPaise = (r: number) => Math.round(r * 100);
const isoDay = (d: Date) => new Date(d).toISOString().slice(0, 10);

export function PricingScreen({
  categories,
  selectedCategoryId,
  guardrail,
  rates,
  canApprove,
}: {
  categories: CategoryGuardrail[];
  selectedCategoryId: string;
  guardrail: CategoryGuardrail | null;
  rates: DynamicRateRow[];
  canApprove: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Per-row adjusted rate (₹), seeded from the suggestion.
  const [adjust, setAdjust] = useState<Record<string, number>>({});

  const run = (fn: () => Promise<{ ok: boolean; error?: { message: string } }>) => {
    setError(null);
    start(async () => {
      const res = await fn();
      if (res.ok) router.refresh();
      else setError(res.error?.message ?? "Something went wrong.");
    });
  };

  const band = guardrail
    ? `${guardrail.floorPaise != null ? rupees(guardrail.floorPaise) : "—"} – ${guardrail.ceilPaise != null ? rupees(guardrail.ceilPaise) : "—"}`
    : "—";

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 p-4">
      <h1 className="text-xl font-semibold">Pricing</h1>

      <div className="space-y-1.5">
        <label htmlFor="cat" className="text-sm font-medium">Category</label>
        <select
          id="cat"
          value={selectedCategoryId}
          onChange={(e) => router.push(`/pricing?cat=${e.target.value}`)}
          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          data-testid="pricing-category"
        >
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            {guardrail?.name ?? "Rates"} · base {guardrail ? rupees(guardrail.baseRatePaise) : "—"}
          </CardTitle>
          <p className="text-xs text-muted-foreground">Guardrail {band}</p>
        </CardHeader>
        <CardContent>
          {error && <p role="alert" className="mb-3 text-sm text-destructive">{error}</p>}
          {rates.length === 0 ? (
            <p className="text-sm text-muted-foreground">No suggestions yet. Run the pricing engine to populate this calendar.</p>
          ) : (
            <ul className="divide-y rounded-md border" data-testid="pricing-list">
              {rates.map((r) => {
                const day = isoDay(r.date);
                const suggestedRupees = r.suggestedPaise / 100;
                const value = adjust[r.id] ?? suggestedRupees;
                return (
                  <li key={r.id} className="space-y-2 p-3 text-sm" data-testid={`rate-${day}`}>
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="font-medium">{day}</p>
                        <p className="text-xs text-muted-foreground">
                          suggest {rupees(r.suggestedPaise)} · {r.status}
                          {r.appliedPaise != null ? ` · applied ${rupees(r.appliedPaise)}` : ""}
                        </p>
                        {r.reason && <p className="text-xs text-muted-foreground">{r.reason}</p>}
                      </div>
                      <span
                        className="rounded px-2 py-0.5 text-xs"
                        data-testid={`rate-status-${day}`}
                      >
                        {r.status}
                      </span>
                    </div>

                    {canApprove && r.status === "SUGGESTED" && (
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          inputMode="numeric"
                          aria-label={`Approved rate for ${day} (₹)`}
                          value={value}
                          onChange={(e) => setAdjust((a) => ({ ...a, [r.id]: Number(e.target.value) }))}
                          className="h-10 w-28"
                          data-testid={`rate-input-${day}`}
                        />
                        <Button
                          size="sm"
                          disabled={pending || value <= 0}
                          onClick={() => run(() => approveRate({ dynamicRateId: r.id, appliedPaise: toPaise(value) }))}
                          data-testid={`rate-approve-${day}`}
                        >
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={pending}
                          onClick={() => run(() => rejectRate({ dynamicRateId: r.id, reason: "rejected" }))}
                          data-testid={`rate-reject-${day}`}
                        >
                          Reject
                        </Button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
