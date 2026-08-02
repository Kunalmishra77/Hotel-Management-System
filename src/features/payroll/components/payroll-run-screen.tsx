"use client";

/**
 * Payroll run detail — 21 T-18/T-19 (AC-6/7/8). Per-line bonus/deduction/advance
 * editing with an override-reason field, finalize, and payslip download. Amounts
 * shown in ₹; all rules (RUN_LOCKED, override reason, floor) are server-enforced.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { adjustLine, finalizeRun } from "../actions";
import type { PayrollLineView, PayrollRunView } from "../queries";

const rupees = (p: number) => `₹${(p / 100).toLocaleString("en-IN")}`;
const toPaise = (r: number) => Math.round(r * 100);

export function PayrollRunScreen({ run }: { run: PayrollRunView }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const draft = run.status === "DRAFT";

  const call = (fn: () => Promise<{ ok: boolean; error?: { message: string } }>) => {
    setError(null);
    start(async () => {
      const res = await fn();
      if (res.ok) router.refresh();
      else setError(res.error?.message ?? "Something went wrong.");
    });
  };

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 p-4">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">
          Payroll · {run.month}{run.sequence > 1 ? ` · adj #${run.sequence}` : ""}
        </h1>
        <span className="rounded bg-muted px-2 py-1 text-xs font-medium" data-testid="run-status">{run.status}</span>
      </header>

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

      <ul className="space-y-3" data-testid="payroll-lines">
        {run.lines.map((line) => (
          <LineCard key={line.id} line={line} editable={draft} pending={pending} onSave={call} />
        ))}
      </ul>

      <Card>
        <CardContent className="flex items-center justify-between p-4">
          <span className="text-sm text-muted-foreground">Total</span>
          <span className="text-lg font-semibold" data-testid="run-total">{rupees(run.netTotalPaise)}</span>
        </CardContent>
      </Card>

      {draft && (
        <Button size="lg" className="w-full" disabled={pending}
          onClick={() => call(() => finalizeRun({ runId: run.id }))} data-testid="finalize-run">
          Finalize &amp; generate payslips
        </Button>
      )}
    </div>
  );
}

function LineCard({
  line, editable, pending, onSave,
}: {
  line: PayrollLineView;
  editable: boolean;
  pending: boolean;
  onSave: (fn: () => Promise<{ ok: boolean; error?: { message: string } }>) => void;
}) {
  const [bonus, setBonus] = useState(line.bonusPaise / 100);
  const [deduction, setDeduction] = useState(line.deductionPaise / 100);
  const [advance, setAdvance] = useState(line.advancePaise / 100);
  const [reason, setReason] = useState("");

  return (
    <li>
      <Card data-testid={`line-${line.id}`}>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center justify-between text-base">
            <span>{line.staffName}</span>
            <span data-testid={`net-${line.id}`}>{rupees(line.netPaise)}</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p className="text-xs text-muted-foreground">
            base {rupees(line.basePaise)} · OT {rupees(line.overtimePaise)}
            {line.paidDays != null ? ` · paid ${line.paidDays}d` : ""}
            {line.lopDays ? ` · LOP ${line.lopDays}d` : ""}
          </p>
          {editable ? (
            <div className="space-y-2">
              <div className="grid grid-cols-3 gap-2">
                <label className="text-xs">Bonus ₹<Input type="number" inputMode="numeric" value={bonus} onChange={(e) => setBonus(Number(e.target.value))} data-testid={`bonus-${line.id}`} /></label>
                <label className="text-xs">Deduct ₹<Input type="number" inputMode="numeric" value={deduction} onChange={(e) => setDeduction(Number(e.target.value))} data-testid={`deduction-${line.id}`} /></label>
                <label className="text-xs">Advance ₹<Input type="number" inputMode="numeric" value={advance} onChange={(e) => setAdvance(Number(e.target.value))} data-testid={`advance-${line.id}`} /></label>
              </div>
              <Input placeholder="Reason (required to override base/OT)" value={reason} onChange={(e) => setReason(e.target.value)} data-testid={`reason-${line.id}`} />
              <Button size="sm" disabled={pending} data-testid={`save-${line.id}`}
                onClick={() => onSave(() => adjustLine({ lineId: line.id, bonusPaise: toPaise(bonus), deductionPaise: toPaise(deduction), advancePaise: toPaise(advance), reason: reason || undefined }))}>
                Save
              </Button>
            </div>
          ) : (
            line.hasPayslip && (
              <a href={`/payroll/payslip/${line.id}`} className="text-primary underline" data-testid={`payslip-${line.id}`}>
                Download payslip
              </a>
            )
          )}
        </CardContent>
      </Card>
    </li>
  );
}
