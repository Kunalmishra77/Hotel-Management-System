"use client";

/**
 * Payroll run list + generate — 21 T-18 (AC-1/10). Mobile-first; ≥44px actions.
 * RBAC + idempotency are enforced server-side; this UI just surfaces the result.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { generateRun } from "../actions";
import type { PayrollRunSummary } from "../queries";

const rupees = (p: number) => `₹${(p / 100).toLocaleString("en-IN")}`;
const thisMonth = () => new Date().toISOString().slice(0, 7);

export function PayrollScreen({ propertyId, runs }: { propertyId: string; runs: PayrollRunSummary[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [month, setMonth] = useState(thisMonth());

  const onGenerate = () => {
    setError(null);
    start(async () => {
      const res = await generateRun({ propertyId, month });
      if (res.ok) router.push(`/payroll/${res.data.runId}`);
      else setError(res.error?.message ?? "Could not generate the run.");
    });
  };

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 p-4">
      <h1 className="text-xl font-semibold">Payroll</h1>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Generate a monthly run</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="pr-month">Month</Label>
            <Input id="pr-month" type="month" value={month} onChange={(e) => setMonth(e.target.value)} data-testid="payroll-month" />
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <Button size="lg" disabled={pending} onClick={onGenerate} data-testid="payroll-generate">
            {pending ? "Generating…" : "Generate run"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Runs</CardTitle></CardHeader>
        <CardContent>
          {runs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No runs yet.</p>
          ) : (
            <ul className="divide-y rounded-md border" data-testid="payroll-runs">
              {runs.map((r) => (
                <li key={r.id} className="p-3 text-sm" data-testid={`run-${r.id}`}>
                  <Link href={`/payroll/${r.id}`} className="flex items-center justify-between gap-2">
                    <span className="font-medium">
                      {r.month}{r.sequence > 1 ? ` · adj #${r.sequence}` : ""}
                    </span>
                    <span className="text-muted-foreground">{rupees(r.netTotalPaise)} · {r.status}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
