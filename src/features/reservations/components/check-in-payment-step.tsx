"use client";

/**
 * Check-in wizard · Payment step (03 T6). Behaviour follows the booking's
 * settlement intent (MoM): PAY_AT_HOTEL collects at the desk now (cash/card/UPI,
 * split tenders) via billing's recordPayment; ALREADY_PAID shows the prepayment
 * that posts at check-in; UNPAID_ONLINE shows a pending link (HDFC wiring is T8).
 * The folio is still empty here (room-nights accrue at checkout), so amounts work
 * off the booking estimate — the exact settlement squares at check-out.
 */
import { useState, useTransition, type ReactNode } from "react";
import { toast } from "sonner";
import { Plus, Trash2, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatINR } from "@/lib/utils";
import { recordPayment } from "@/features/billing/payment-actions";
import type { CheckInContext } from "../queries";

const MODES = [
  { value: "CASH", label: "Cash" },
  { value: "UPI", label: "UPI" },
  { value: "CREDIT_CARD", label: "Credit card" },
  { value: "DEBIT_CARD", label: "Debit card" },
  { value: "BANK_TRANSFER", label: "Bank transfer" },
] as const;
const MODE_LABEL: Record<string, string> = Object.fromEntries(MODES.map((m) => [m.value, m.label]));

type Tender = { mode: string; amountPaise: number };

export function PaymentStep({
  context,
  collectedPaise,
  onCollected,
}: {
  context: CheckInContext;
  collectedPaise: number;
  onCollected: (amountPaise: number) => void;
}) {
  const [mode, setMode] = useState<string>("CASH");
  const [amount, setAmount] = useState("");
  const [tenders, setTenders] = useState<Tender[]>([]);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const duePaise = Math.max(0, context.estimatedBalancePaise - collectedPaise);
  const tenderTotal = tenders.reduce((s, t) => s + t.amountPaise, 0);

  if (context.settlementIntent === "ALREADY_PAID") {
    return (
      <InfoPanel
        title="Prepaid"
        tone="success"
        body={`Marked already paid at booking. ${formatINR(context.advancePaise)} is recorded to the folio at check-in.`}
      />
    );
  }
  if (context.settlementIntent === "UNPAID_ONLINE") {
    return (
      <InfoPanel
        title="Awaiting online payment"
        tone="muted"
        body="A secure payment link is sent to the guest after check-in. Nothing is collected at the desk; the folio settles when the gateway confirms."
      />
    );
  }

  const addTender = () => {
    const rupees = Number(amount);
    if (!Number.isFinite(rupees) || rupees <= 0) {
      setError("Enter an amount to add.");
      return;
    }
    setError(null);
    setTenders((prev) => [...prev, { mode, amountPaise: Math.round(rupees * 100) }]);
    setAmount("");
  };

  const record = () => {
    const folioId = context.folioId;
    if (!folioId) {
      setError("This booking has no folio yet.");
      return;
    }
    if (tenders.length === 0) {
      setError("Add at least one tender to collect.");
      return;
    }
    setError(null);
    start(async () => {
      const res = await recordPayment({ folioId, tenders });
      if (!res.ok) {
        setError(res.error?.message ?? "Could not record the payment.");
        return;
      }
      onCollected(res.data.totalPaise);
      setTenders([]);
      toast.success(`Collected ${formatINR(res.data.totalPaise)}`);
    });
  };

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-semibold">Collect payment</h3>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Pay at hotel — take a deposit or the full balance now, or skip and settle at check-out.
        </p>
      </div>

      <dl className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
        <Line label="Estimated stay total">{formatINR(context.estimatedTotalPaise)}</Line>
        <Line label="Advance (posts at check-in)">{formatINR(context.advancePaise)}</Line>
        {collectedPaise > 0 ? <Line label="Collected now">{formatINR(collectedPaise)}</Line> : null}
        <div className="mt-1 flex justify-between border-t border-border pt-2 font-medium">
          <dt>Balance to collect</dt>
          <dd data-testid="due-amount">{formatINR(duePaise)}</dd>
        </div>
      </dl>

      <div className="space-y-3 rounded-lg border border-border p-3.5">
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="pay-mode">Mode</Label>
            <Select value={mode} onValueChange={setMode}>
              <SelectTrigger id="pay-mode" data-testid="pay-mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MODES.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pay-amount">Amount (₹)</Label>
            <Input
              id="pay-amount"
              data-testid="pay-amount"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              placeholder={duePaise > 0 ? String(Math.round(duePaise / 100)) : "0"}
            />
          </div>
          <Button type="button" variant="outline" onClick={addTender} data-testid="add-tender">
            <Plus /> Add
          </Button>
        </div>

        {tenders.length > 0 ? (
          <ul className="space-y-1.5" data-testid="tenders">
            {tenders.map((t, i) => (
              <li key={i} className="flex items-center justify-between rounded-md bg-muted/40 px-3 py-1.5 text-sm">
                <span>
                  {MODE_LABEL[t.mode] ?? t.mode} · <span className="font-medium">{formatINR(t.amountPaise)}</span>
                </span>
                <button
                  type="button"
                  onClick={() => setTenders((prev) => prev.filter((_, j) => j !== i))}
                  className="text-muted-foreground hover:text-destructive"
                  aria-label="Remove tender"
                >
                  <Trash2 className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        {error ? (
          <p role="alert" className="text-sm text-destructive" data-testid="payment-error">
            {error}
          </p>
        ) : null}

        <Button
          type="button"
          onClick={record}
          disabled={pending || tenders.length === 0}
          className="w-full sm:w-auto"
          data-testid="record-payment"
        >
          <Wallet /> {pending ? "Recording…" : `Record ${formatINR(tenderTotal)}`}
        </Button>
      </div>
    </div>
  );
}

function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between py-0.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}

function InfoPanel({ title, body, tone }: { title: string; body: string; tone: "success" | "muted" }) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">Payment</h3>
      <div
        className={`rounded-lg border p-4 text-sm ${
          tone === "success" ? "border-success/40 bg-success/5" : "border-border bg-muted/30"
        }`}
      >
        <p className="font-medium">{title}</p>
        <p className="mt-1 text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}
