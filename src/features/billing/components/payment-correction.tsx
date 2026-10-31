"use client";

/**
 * Correct a payment entered by mistake (wrong mode, wrong amount, or it belongs
 * to another bill). The wrong entry is cancelled — never deleted — and, unless
 * "Just cancel it" is chosen, re-entered with the right mode / amount on its
 * original date. Calls correctPaymentEntry (audited, permission-checked).
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PaymentModeSelect } from "@/components/forms/payment-mode-select";

const rupees = (p: number) => `₹${(p / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function PaymentCorrectionForm({
  payment,
  pending,
  onSubmit,
  onCancel,
}: {
  payment: { id: string; mode: string; amountPaise: number };
  pending: boolean;
  onSubmit: (v: { reason: string; newMode?: string; newAmountPaise?: number }) => void;
  onCancel: () => void;
}) {
  const [action, setAction] = useState<"reenter" | "cancel">("reenter");
  const [mode, setMode] = useState<string>("");
  const [amount, setAmount] = useState(String(payment.amountPaise / 100));
  const [reason, setReason] = useState("");
  const amountPaise = Math.round(Number(amount) * 100);
  const invalid = reason.trim().length < 3 || (action === "reenter" && (!mode || !(amountPaise > 0)));

  return (
    <form
      className="space-y-3 rounded-md border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (invalid) return;
        onSubmit(action === "reenter" ? { reason: reason.trim(), newMode: mode, newAmountPaise: amountPaise } : { reason: reason.trim() });
      }}
      data-testid="payment-correction"
    >
      <p className="text-sm font-medium">Correct payment · {payment.mode} {rupees(payment.amountPaise)}</p>
      <div className="flex flex-col gap-1.5 text-sm">
        <label className="flex items-center gap-2">
          <input type="radio" name="correct-action" checked={action === "reenter"} onChange={() => setAction("reenter")} />
          Re-enter it correctly (different mode / amount)
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="correct-action" checked={action === "cancel"} onChange={() => setAction("cancel")} />
          Just cancel it (entered twice / on the wrong bill)
        </label>
      </div>
      {action === "reenter" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="correct-mode">Correct mode</Label>
            <PaymentModeSelect id="correct-mode" value={mode} onChange={setMode} required testId="correct-mode" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="correct-amount">Correct amount (₹)</Label>
            <Input id="correct-amount" type="number" inputMode="decimal" step="0.01" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="correct-amount" />
          </div>
        </div>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="correct-reason">What was wrong?</Label>
        <Input id="correct-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. guest paid by UPI, not cash" data-testid="correct-reason" />
      </div>
      <p className="text-xs text-muted-foreground">The wrong entry stays in the history as cancelled — nothing is deleted. Older than today needs Accounts / Admin.</p>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending || invalid} data-testid="correct-submit">Save correction</Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}
