"use client";

/**
 * Expenses screen — 07 T-9/T-10 (AC-1/4/5). Photo-first entry + an approval queue.
 * Amounts entered in ₹; the STAFF-head salary guard and RBAC are enforced
 * server-side (this UI just surfaces the error). Mobile-first: ≥44px actions.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createExpense, approveExpense, rejectExpense } from "../actions";
import type { ExpenseListItem } from "../queries";

const HEADS = ["HOUSEKEEPING", "KITCHEN", "MAINTENANCE", "UTILITIES", "STAFF", "ADMINISTRATION", "MISC"];
// Payment methods (client req #14) — how the expense was actually paid.
const PAY_MODES: { value: string; label: string }[] = [
  { value: "CASH", label: "Cash" },
  { value: "UPI", label: "UPI" },
  { value: "BANK_TRANSFER", label: "Bank transfer" },
  { value: "CREDIT_CARD", label: "Credit card" },
  { value: "DEBIT_CARD", label: "Debit card" },
  { value: "ONLINE", label: "Online" },
  { value: "CORPORATE_CREDIT", label: "Corporate credit" },
];
const rupees = (p: number) => `₹${(p / 100).toLocaleString("en-IN")}`;
const toPaise = (r: number) => Math.round(r * 100);

export function ExpensesScreen({
  propertyId,
  properties,
  expenses,
  canApprove,
  todayTotalPaise,
}: {
  propertyId: string;
  properties?: { id: string; name: string }[];
  expenses: ExpenseListItem[];
  canApprove: boolean;
  todayTotalPaise: number;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [head, setHead] = useState("KITCHEN");
  const [sub, setSub] = useState("");
  const [amount, setAmount] = useState(0);
  const [paidVia, setPaidVia] = useState("CASH");
  const [property, setProperty] = useState(propertyId);
  const [spentOn, setSpentOn] = useState(new Date().toISOString().slice(0, 10));
  const propertyOptions = properties && properties.length > 1 ? properties : null;

  const run = (fn: () => Promise<{ ok: boolean; error?: { message: string } }>, onOk?: () => void) => {
    setError(null);
    start(async () => {
      const res = await fn();
      if (res.ok) { onOk?.(); router.refresh(); }
      else setError(res.error?.message ?? "Something went wrong.");
    });
  };

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 p-4">
      <h1 className="text-xl font-semibold">Expenses</h1>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Record an expense</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            {propertyOptions && (
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="exp-prop">Property</Label>
                <select id="exp-prop" value={property} onChange={(e) => setProperty(e.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" data-testid="expense-property">
                  {propertyOptions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="exp-head">Head</Label>
              <select id="exp-head" value={head} onChange={(e) => setHead(e.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" data-testid="expense-head">
                {HEADS.map((h) => <option key={h} value={h}>{h}</option>)}
              </select>
            </div>
            <div className="space-y-1.5"><Label htmlFor="exp-sub">Sub-category</Label><Input id="exp-sub" value={sub} onChange={(e) => setSub(e.target.value)} data-testid="expense-sub" /></div>
            <div className="space-y-1.5"><Label htmlFor="exp-amt">Amount (₹)</Label><Input id="exp-amt" type="number" inputMode="numeric" value={amount} onChange={(e) => setAmount(Number(e.target.value))} data-testid="expense-amount" /></div>
            <div className="space-y-1.5">
              <Label htmlFor="exp-pay">Payment method</Label>
              <select id="exp-pay" value={paidVia} onChange={(e) => setPaidVia(e.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" data-testid="expense-paidvia">
                {PAY_MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>
            <div className="space-y-1.5"><Label htmlFor="exp-date">Date</Label><Input id="exp-date" type="date" value={spentOn} onChange={(e) => setSpentOn(e.target.value)} data-testid="expense-date" /></div>
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <Button size="lg" disabled={pending || amount <= 0}
            onClick={() => run(() => createExpense({ propertyId: property, head, subCategory: sub || undefined, amountPaise: toPaise(amount), spentOn, paidVia: paidVia as never }), () => { setSub(""); setAmount(0); })}
            data-testid="expense-save">Save</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Recent · today <span data-testid="today-total">{rupees(todayTotalPaise)}</span></CardTitle></CardHeader>
        <CardContent>
          {expenses.length === 0 ? (
            <p className="text-sm text-muted-foreground">No expenses yet.</p>
          ) : (
            <ul className="divide-y rounded-md border" data-testid="expense-list">
              {expenses.map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-2 p-3 text-sm" data-testid={`expense-${e.id}`}>
                  <div>
                    <p className="font-medium">{e.head}{e.subCategory ? ` · ${e.subCategory}` : ""}</p>
                    <p className="text-xs text-muted-foreground">{rupees(e.amountPaise)} · {e.status}{e.hasBill ? " · 📎" : ""}</p>
                  </div>
                  {canApprove && e.status === "DRAFT" && (
                    <div className="flex gap-2">
                      <Button size="sm" disabled={pending} onClick={() => run(() => approveExpense({ expenseId: e.id }))} data-testid={`approve-${e.id}`}>Approve</Button>
                      <Button size="sm" variant="outline" disabled={pending} onClick={() => {
                        const reason = window.prompt("Reason for rejecting this expense?")?.trim();
                        if (reason) run(() => rejectExpense({ expenseId: e.id, reason }));
                      }}>Reject</Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
