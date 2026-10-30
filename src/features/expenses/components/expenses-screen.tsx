"use client";

/**
 * Expenses screen — 07 + restructure (#12–20), laid out like a paper PARCHI (bill
 * slip): the shared facts are filled once at the top (date, property, paid via,
 * head), then the slip is a table of item rows (milk, bread, eggs…) the staff keep
 * adding to, with the running total underneath and ONE save for the whole slip.
 * Each row is still its own Expense (own amount + approval), written together in
 * one transaction. The recent list reads the same way — grouped by date with the
 * day's total. STAFF-salary guard + RBAC are server-enforced.
 */
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createExpenses, approveExpense, rejectExpense } from "../actions";
import {
  EXPENSE_HEADS, EXPENSE_HEAD_LABEL, EXPENSE_SUBCATEGORIES,
  FREE_TEXT_SUBCATEGORY, GST_BILLS_HEAD, type ExpenseHeadKey,
} from "../subcategories";
import type { ExpenseListItem, ExpenseSuggestions, PendingExpense } from "../queries";
import { PendingApprovals } from "./pending-approvals";

/** One row on the slip (amount kept as the typed ₹ string so the input stays editable). */
type SlipRow = { key: string; item: string; qty: string; amount: string };

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
const toPaise = (r: string) => Math.round(Number(r || 0) * 100);
const newRow = (): SlipRow => ({ key: crypto.randomUUID(), item: "", qty: "", amount: "" });
const dayLabel = (d: Date) => new Date(d).toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short", year: "numeric" });

export function ExpensesScreen({
  propertyId,
  properties,
  expenses,
  canApprove,
  pendingApprovals = [],
  todayTotalPaise,
  suggestions,
}: {
  propertyId: string;
  properties?: { id: string; name: string }[];
  expenses: ExpenseListItem[];
  canApprove: boolean;
  /** Approval queue across the properties in view — pinned above everything. */
  pendingApprovals?: PendingExpense[];
  todayTotalPaise: number;
  suggestions?: ExpenseSuggestions;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  // Slip header — filled once for the whole parchi.
  const [spentOn, setSpentOn] = useState(new Date().toISOString().slice(0, 10));
  const [property, setProperty] = useState(propertyId);
  const [paidVia, setPaidVia] = useState("CASH");
  const [head, setHead] = useState<ExpenseHeadKey>("KITCHEN");
  const [sub, setSub] = useState("");
  const [gstNumber, setGstNumber] = useState("");
  const [vendor, setVendor] = useState("");
  // Slip body.
  const [rows, setRows] = useState<SlipRow[]>([newRow()]);
  const itemRefs = useRef(new Map<string, HTMLInputElement>());
  const propertyOptions = properties && properties.length > 1 ? properties : null;

  const subList = EXPENSE_SUBCATEGORIES[head] ?? [];
  const subIsFreeText = FREE_TEXT_SUBCATEGORY.has(head) || subList.length === 0;
  const isGstBills = head === GST_BILLS_HEAD;
  const sugg = suggestions ?? { gstins: [], vendors: [], subCategories: [], descriptions: [] };

  function onGstChange(v: string) {
    setGstNumber(v);
    const hit = sugg.gstins.find((g) => g.gstNumber.toLowerCase() === v.trim().toLowerCase());
    if (hit?.vendor) setVendor(hit.vendor);
  }

  const setRow = (key: string, patch: Partial<SlipRow>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  function addRow() {
    const r = newRow();
    setRows((rs) => [...rs, r]);
    // Focus the new row's item box so typing the next line is one motion.
    setTimeout(() => itemRefs.current.get(r.key)?.focus(), 0);
  }
  const removeRow = (key: string) => setRows((rs) => (rs.length > 1 ? rs.filter((r) => r.key !== key) : [newRow()]));

  // A row counts once anything is typed in it; it's valid with an item + amount > 0.
  const touched = rows.filter((r) => r.item.trim() || r.amount.trim() || r.qty.trim());
  const invalidIdx = rows.findIndex((r) => (r.item.trim() || r.amount.trim() || r.qty.trim()) && !(r.item.trim() && toPaise(r.amount) > 0));
  const totalPaise = touched.reduce((s, r) => s + Math.max(0, toPaise(r.amount)), 0);

  const run = (fn: () => Promise<{ ok: boolean; error?: { message: string } }>, onOk?: () => void) => {
    setError(null);
    start(async () => {
      const res = await fn();
      if (res.ok) { onOk?.(); router.refresh(); }
      else setError(res.error?.message ?? "Something went wrong.");
    });
  };

  function saveSlip() {
    if (touched.length === 0) { setError("Add at least one item to the parchi."); return; }
    if (invalidIdx >= 0) { setError(`Line ${invalidIdx + 1}: enter both the item and its amount.`); return; }
    const count = touched.length;
    const total = totalPaise;
    run(
      () => createExpenses({
        items: touched.map((r) => ({
          propertyId: property,
          head,
          subCategory: sub.trim() && sub !== "Other" ? sub.trim() : undefined,
          description: r.item.trim(),
          quantity: r.qty.trim() || undefined,
          amountPaise: toPaise(r.amount),
          spentOn,
          paidVia: paidVia as never,
          gstNumber: isGstBills && gstNumber ? gstNumber : undefined,
          vendor: isGstBills && vendor ? vendor : undefined,
        })),
      }),
      () => { setRows([newRow()]); setSaved(`Saved parchi — ${count} item${count > 1 ? "s" : ""}, ${rupees(total)}`); setTimeout(() => setSaved(null), 4000); },
    );
  }

  // Recent list as parchis: grouped by date, each with the day's total.
  const byDay = new Map<string, ExpenseListItem[]>();
  for (const e of expenses) {
    const k = new Date(e.spentOn).toISOString().slice(0, 10);
    byDay.set(k, [...(byDay.get(k) ?? []), e]);
  }

  const selectCls = "h-10 w-full rounded-md border border-input bg-background px-3 text-sm";

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 p-4">
      <h1 className="text-xl font-semibold">Expenses</h1>
      {canApprove && <PendingApprovals items={pendingApprovals} />}

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader className="pb-3"><CardTitle className="text-base">New parchi</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {/* Slip header — once for every line below. */}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5"><Label htmlFor="exp-date">Date</Label><Input id="exp-date" type="date" value={spentOn} onChange={(e) => setSpentOn(e.target.value)} data-testid="expense-date" /></div>
              <div className="space-y-1.5">
                <Label htmlFor="exp-pay">Paid via</Label>
                <select id="exp-pay" value={paidVia} onChange={(e) => setPaidVia(e.target.value)} className={selectCls} data-testid="expense-paidvia">
                  {PAY_MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </div>
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
                <select id="exp-head" value={head} onChange={(e) => { setHead(e.target.value as ExpenseHeadKey); setSub(""); }} className={selectCls} data-testid="expense-head">
                  {EXPENSE_HEADS.map((h) => <option key={h} value={h}>{EXPENSE_HEAD_LABEL[h]}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="exp-sub">Sub-category <span className="text-muted-foreground">(optional)</span></Label>
                {subIsFreeText ? (
                  <Input id="exp-sub" list="dl-sub" value={sub} onChange={(e) => setSub(e.target.value)} placeholder={isGstBills ? "e.g. Building work" : "e.g. Groceries"} data-testid="expense-sub" />
                ) : (
                  <select id="exp-sub" value={sub} onChange={(e) => setSub(e.target.value)} className={selectCls} data-testid="expense-sub">
                    <option value="">—</option>
                    {subList.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                )}
              </div>
              {isGstBills && (
                <>
                  <div className="space-y-1.5"><Label htmlFor="exp-gstin">GSTIN</Label><Input id="exp-gstin" list="dl-gstin" value={gstNumber} onChange={(e) => onGstChange(e.target.value)} placeholder="Supplier GST number" data-testid="expense-gstin" /></div>
                  <div className="space-y-1.5"><Label htmlFor="exp-vendor">Vendor / supplier</Label><Input id="exp-vendor" list="dl-vendor" value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="Business name" data-testid="expense-vendor" /></div>
                </>
              )}
            </div>

            {/* Slip body — one line per item, like the paper parchi. */}
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full min-w-[22rem] text-sm" data-testid="expense-slip">
                <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="w-8 px-2 py-2 text-left font-medium">#</th>
                    <th className="px-2 py-2 text-left font-medium">Item</th>
                    <th className="w-24 px-2 py-2 text-left font-medium">Qty</th>
                    <th className="w-28 px-2 py-2 text-right font-medium">Amount ₹</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows.map((r, i) => (
                    <tr key={r.key} data-testid={`slip-row-${i}`} className={i === invalidIdx && error ? "bg-destructive/5" : ""}>
                      <td className="px-2 py-1.5 text-muted-foreground tabular-nums">{i + 1}</td>
                      <td className="px-1 py-1.5">
                        <Input ref={(el) => { if (el) itemRefs.current.set(r.key, el); else itemRefs.current.delete(r.key); }} list="dl-desc" value={r.item} onChange={(e) => setRow(r.key, { item: e.target.value })} placeholder={i === 0 ? "e.g. Milk" : ""} aria-label={`Item ${i + 1}`} data-testid={`slip-item-${i}`} />
                      </td>
                      <td className="px-1 py-1.5">
                        <Input value={r.qty} onChange={(e) => setRow(r.key, { qty: e.target.value })} placeholder={i === 0 ? "2 L" : ""} aria-label={`Quantity ${i + 1}`} data-testid={`slip-qty-${i}`} />
                      </td>
                      <td className="px-1 py-1.5">
                        <Input
                          type="number" inputMode="decimal" step="0.01" min={0}
                          className="text-right tabular-nums"
                          value={r.amount}
                          onChange={(e) => setRow(r.key, { amount: e.target.value })}
                          // Enter on the last line's amount starts the next line.
                          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (i === rows.length - 1) addRow(); } }}
                          aria-label={`Amount ${i + 1}`}
                          data-testid={`slip-amount-${i}`}
                        />
                      </td>
                      <td className="px-1 text-center">
                        <button type="button" aria-label={`Remove line ${i + 1}`} className="text-muted-foreground hover:text-destructive" onClick={() => removeRow(r.key)} data-testid={`slip-remove-${i}`}>✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t bg-muted/30 font-semibold">
                    <td colSpan={3} className="px-2 py-2">Total · {touched.length} item{touched.length === 1 ? "" : "s"}</td>
                    <td className="px-2 py-2 text-right tabular-nums" data-testid="slip-total">{rupees(totalPaise)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>

            <datalist id="dl-gstin">{sugg.gstins.map((g) => <option key={g.gstNumber} value={g.gstNumber} label={g.vendor ?? undefined} />)}</datalist>
            <datalist id="dl-vendor">{sugg.vendors.map((v) => <option key={v} value={v} />)}</datalist>
            <datalist id="dl-sub">{sugg.subCategories.map((s) => <option key={s} value={s} />)}</datalist>
            <datalist id="dl-desc">{sugg.descriptions.map((d) => <option key={d} value={d} />)}</datalist>

            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            {saved && <p className="rounded-md border border-emerald-600/30 bg-emerald-500/10 p-2 text-sm text-emerald-700 dark:text-emerald-400" data-testid="slip-saved">✔ {saved}</p>}

            <div className="flex flex-col gap-2 sm:flex-row">
              <Button variant="outline" className="sm:flex-1" disabled={pending} onClick={addRow} data-testid="expense-add-item">+ Add item</Button>
              <Button size="lg" className="sm:flex-1" disabled={pending || touched.length === 0} onClick={saveSlip} data-testid="expense-save">
                {pending ? "Saving…" : `Save parchi${touched.length ? ` · ${rupees(totalPaise)}` : ""}`}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2 lg:sticky lg:top-2 lg:self-start">
          <CardHeader className="pb-3"><CardTitle className="text-base">Parchis by date · today <span data-testid="today-total">{rupees(todayTotalPaise)}</span></CardTitle></CardHeader>
          <CardContent>
            {expenses.length === 0 ? (
              <p className="text-sm text-muted-foreground">No expenses yet.</p>
            ) : (
              <div className="max-h-[32rem] space-y-3 overflow-y-auto" data-testid="expense-list">
                {[...byDay.entries()].map(([day, items]) => {
                  const dayTotal = items.reduce((s, e) => s + e.amountPaise, 0);
                  const drafts = items.filter((e) => e.status === "DRAFT");
                  return (
                    <div key={day} className="rounded-md border" data-testid={`parchi-${day}`}>
                      <div className="flex items-center justify-between gap-2 border-b bg-muted/40 px-3 py-2 text-sm">
                        <span className="font-medium">{dayLabel(new Date(`${day}T00:00:00Z`))}</span>
                        {canApprove && drafts.length > 1 && (
                          <Button size="sm" variant="outline" disabled={pending} onClick={() => run(async () => {
                            for (const e of drafts) { const r = await approveExpense({ expenseId: e.id }); if (!r.ok) return r; }
                            return { ok: true };
                          })} data-testid={`approve-day-${day}`}>Approve all ({drafts.length})</Button>
                        )}
                      </div>
                      <ul className="divide-y text-sm">
                        {items.map((e) => (
                          <li key={e.id} className="flex items-center justify-between gap-2 px-3 py-2" data-testid={`expense-${e.id}`}>
                            <div className="min-w-0">
                              <p className="truncate">
                                <span className="font-medium">{e.description || e.subCategory || EXPENSE_HEAD_LABEL[e.head as ExpenseHeadKey] || e.head}</span>
                                {e.quantity ? <span className="text-muted-foreground"> · {e.quantity}</span> : null}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {EXPENSE_HEAD_LABEL[e.head as ExpenseHeadKey] ?? e.head} ·{" "}
                                {/* Only APPROVED spend counts in reports / profit — say so plainly. */}
                                <span className={e.status === "DRAFT" ? "font-medium text-amber-700 dark:text-amber-400" : e.status === "REJECTED" ? "text-destructive" : "text-emerald-700 dark:text-emerald-400"} data-testid={`expense-status-${e.id}`}>
                                  {e.status === "DRAFT" ? "Pending approval — not in reports yet" : e.status === "REJECTED" ? "Rejected" : "Approved"}
                                </span>
                                {e.hasBill ? " · 📎" : ""}
                              </p>
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                              <span className="tabular-nums">{rupees(e.amountPaise)}</span>
                              {canApprove && e.status === "DRAFT" && (
                                <>
                                  <Button size="sm" disabled={pending} onClick={() => run(() => approveExpense({ expenseId: e.id }))} data-testid={`approve-${e.id}`}>✓</Button>
                                  <Button size="sm" variant="outline" disabled={pending} aria-label="Reject" onClick={() => {
                                    const reason = window.prompt("Reason for rejecting this expense?")?.trim();
                                    if (reason) run(() => rejectExpense({ expenseId: e.id, reason }));
                                  }}>✕</Button>
                                </>
                              )}
                            </div>
                          </li>
                        ))}
                      </ul>
                      <div className="flex justify-between border-t px-3 py-2 text-sm font-semibold">
                        <span>Total · {items.length} item{items.length === 1 ? "" : "s"}</span>
                        <span className="tabular-nums">{rupees(dayTotal)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
