"use client";

/**
 * Expenses screen — 07 + restructure (#12–20). Dynamic entry: pick a Head and the
 * Subcategory options change; Kitchen shows a quantity; "Only GST Bills" captures a
 * GSTIN + vendor. Amounts in ₹; the STAFF-salary guard + RBAC are server-enforced.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createExpense, approveExpense, rejectExpense } from "../actions";
import {
  EXPENSE_HEADS, EXPENSE_HEAD_LABEL, EXPENSE_SUBCATEGORIES,
  FREE_TEXT_SUBCATEGORY, QUANTITY_HEADS, GST_BILLS_HEAD, type ExpenseHeadKey,
} from "../subcategories";
import type { ExpenseListItem } from "../queries";

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
  const [head, setHead] = useState<ExpenseHeadKey>("KITCHEN");
  const [sub, setSub] = useState(""); // dropdown value for list-heads
  const [subText, setSubText] = useState(""); // free text (free-text head or "Other")
  const [description, setDescription] = useState("");
  const [quantity, setQuantity] = useState("");
  const [amount, setAmount] = useState(0);
  const [paidVia, setPaidVia] = useState("CASH");
  const [gstNumber, setGstNumber] = useState("");
  const [vendor, setVendor] = useState("");
  const [property, setProperty] = useState(propertyId);
  const [spentOn, setSpentOn] = useState(new Date().toISOString().slice(0, 10));
  const propertyOptions = properties && properties.length > 1 ? properties : null;

  const subList = EXPENSE_SUBCATEGORIES[head] ?? [];
  const headIsFreeText = FREE_TEXT_SUBCATEGORY.has(head);
  const showSubText = headIsFreeText || sub === "Other";
  const showQuantity = QUANTITY_HEADS.has(head);
  const isGstBills = head === GST_BILLS_HEAD;
  const effectiveSub = (headIsFreeText || sub === "Other" ? subText : sub).trim();

  function changeHead(h: ExpenseHeadKey) {
    setHead(h);
    setSub("");
    setSubText("");
  }

  function reset() {
    setSub(""); setSubText(""); setDescription(""); setQuantity(""); setAmount(0); setGstNumber(""); setVendor("");
  }

  const run = (fn: () => Promise<{ ok: boolean; error?: { message: string } }>, onOk?: () => void) => {
    setError(null);
    start(async () => {
      const res = await fn();
      if (res.ok) { onOk?.(); router.refresh(); }
      else setError(res.error?.message ?? "Something went wrong.");
    });
  };

  const selectCls = "h-10 w-full rounded-md border border-input bg-background px-3 text-sm";

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
                <select id="exp-prop" value={property} onChange={(e) => setProperty(e.target.value)} className={selectCls} data-testid="expense-property">
                  {propertyOptions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="exp-head">Head</Label>
              <select id="exp-head" value={head} onChange={(e) => changeHead(e.target.value as ExpenseHeadKey)} className={selectCls} data-testid="expense-head">
                {EXPENSE_HEADS.map((h) => <option key={h} value={h}>{EXPENSE_HEAD_LABEL[h]}</option>)}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="exp-sub">Sub-category</Label>
              {subList.length > 0 ? (
                <select id="exp-sub" value={sub} onChange={(e) => setSub(e.target.value)} className={selectCls} data-testid="expense-sub">
                  <option value="">Select…</option>
                  {subList.map((s) => <option key={s} value={s}>{s}</option>)}
                  <option value="Other">Other…</option>
                </select>
              ) : (
                <Input id="exp-sub" value={subText} onChange={(e) => setSubText(e.target.value)} placeholder={isGstBills ? "e.g. Building work, Large purchase" : "Type the item/expense"} data-testid="expense-sub" />
              )}
            </div>

            {showSubText && subList.length > 0 && (
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="exp-sub-other">Specify</Label>
                <Input id="exp-sub-other" value={subText} onChange={(e) => setSubText(e.target.value)} placeholder="Type the item/expense" data-testid="expense-sub-other" />
              </div>
            )}

            {showQuantity && (
              <div className="space-y-1.5">
                <Label htmlFor="exp-qty">Quantity</Label>
                <Input id="exp-qty" value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="e.g. 10 litres, 5 kg" data-testid="expense-qty" />
              </div>
            )}

            <div className="space-y-1.5"><Label htmlFor="exp-amt">Amount (₹)</Label><Input id="exp-amt" type="number" inputMode="decimal" step="0.01" min={0} value={amount || ""} onChange={(e) => setAmount(Number(e.target.value))} data-testid="expense-amount" /></div>

            <div className="space-y-1.5">
              <Label htmlFor="exp-pay">Payment method</Label>
              <select id="exp-pay" value={paidVia} onChange={(e) => setPaidVia(e.target.value)} className={selectCls} data-testid="expense-paidvia">
                {PAY_MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>

            <div className="space-y-1.5"><Label htmlFor="exp-date">Date</Label><Input id="exp-date" type="date" value={spentOn} onChange={(e) => setSpentOn(e.target.value)} data-testid="expense-date" /></div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="exp-desc">Description / details <span className="font-normal text-muted-foreground">(optional)</span></Label>
              <Input id="exp-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Bathroom pipe replacement" data-testid="expense-desc" />
            </div>

            {isGstBills && (
              <>
                <div className="space-y-1.5"><Label htmlFor="exp-gstin">GSTIN</Label><Input id="exp-gstin" value={gstNumber} onChange={(e) => setGstNumber(e.target.value)} placeholder="Supplier GST number" data-testid="expense-gstin" /></div>
                <div className="space-y-1.5"><Label htmlFor="exp-vendor">Vendor / supplier</Label><Input id="exp-vendor" value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="Business name" data-testid="expense-vendor" /></div>
              </>
            )}
          </div>

          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <Button size="lg" disabled={pending || amount <= 0}
            onClick={() => run(() => createExpense({
              propertyId: property,
              head,
              subCategory: effectiveSub || undefined,
              description: description || undefined,
              quantity: showQuantity && quantity ? quantity : undefined,
              amountPaise: toPaise(amount),
              spentOn,
              paidVia: paidVia as never,
              gstNumber: isGstBills && gstNumber ? gstNumber : undefined,
              vendor: isGstBills && vendor ? vendor : undefined,
            }), reset)}
            data-testid="expense-save">Save</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Recent · today <span data-testid="today-total">{rupees(todayTotalPaise)}</span></CardTitle></CardHeader>
        <CardContent>
          {expenses.length === 0 ? (
            <p className="text-sm text-muted-foreground">No expenses yet.</p>
          ) : (
            // Cap the height and scroll inside — a long list no longer stretches the
            // whole page (the entry form stays reachable without scrolling far down).
            <ul className="max-h-[22rem] divide-y overflow-y-auto rounded-md border" data-testid="expense-list">
              {expenses.map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-2 p-3 text-sm" data-testid={`expense-${e.id}`}>
                  <div>
                    <p className="font-medium">{EXPENSE_HEAD_LABEL[e.head as ExpenseHeadKey] ?? e.head}{e.subCategory ? ` · ${e.subCategory}` : ""}</p>
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
