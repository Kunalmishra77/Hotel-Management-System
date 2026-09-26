/**
 * Centralized expenses ledger (client req #15/#19) — a filterable, cross-property
 * view of spend with per-property / per-head / per-payment-method totals.
 *
 * Pure server component: filters submit via a native GET form (no client JS), so
 * the page re-renders server-side with the new `searchParams`. Every figure is the
 * property-scoped, APPROVED-only rollup from `expensePortfolio`.
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatINR, formatDayMonth } from "@/lib/utils";
import { PAYMENT_MODE_LABEL } from "@/lib/constants/company";
import { ExpensesCharts } from "./expenses-charts";
import type { ExpensePortfolio } from "../queries";

const HEADS = ["HOUSEKEEPING", "KITCHEN", "MAINTENANCE", "UTILITIES", "STAFF", "ADMINISTRATION", "MISC"] as const;
const PAY_MODES = ["CASH", "UPI", "BANK_TRANSFER", "CREDIT_CARD", "DEBIT_CARD", "ONLINE", "CORPORATE_CREDIT"] as const;

const payLabel = (m: string | null): string =>
  m ? (PAYMENT_MODE_LABEL[m as keyof typeof PAYMENT_MODE_LABEL] ?? m) : "—";

export function ExpensesPortfolio({
  data,
  properties,
  filters,
}: {
  data: ExpensePortfolio;
  properties: { id: string; name: string }[];
  filters: { propertyId?: string; head?: string; paidVia?: string; from?: string; to?: string };
}) {
  const cell = "h-10 w-full rounded-md border border-input bg-background px-3 text-sm";
  return (
    <Card className="mt-6">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">All-property expenses</CardTitle>
        <p className="text-sm text-muted-foreground">
          Every property&apos;s spend in one place — filter by property, category, payment method and date. Totals count approved expenses only.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Filter bar — native GET form, re-renders server-side. */}
        <form method="get" className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <select name="property" defaultValue={filters.propertyId ?? ""} className={cell} aria-label="Property">
            <option value="">All properties</option>
            {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select name="head" defaultValue={filters.head ?? ""} className={cell} aria-label="Category">
            <option value="">All categories</option>
            {HEADS.map((h) => <option key={h} value={h}>{h}</option>)}
          </select>
          <select name="paidVia" defaultValue={filters.paidVia ?? ""} className={cell} aria-label="Payment method">
            <option value="">All payment methods</option>
            {PAY_MODES.map((m) => <option key={m} value={m}>{payLabel(m)}</option>)}
          </select>
          <input type="date" name="from" defaultValue={filters.from ?? ""} className={cell} aria-label="From date" />
          <input type="date" name="to" defaultValue={filters.to ?? ""} className={cell} aria-label="To date" />
          <button type="submit" className="h-10 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">Apply</button>
        </form>

        {/* Totals */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-lg border bg-muted/30 p-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Total (approved)</p>
            <p className="mt-1 text-lg font-semibold tabular">{formatINR(data.totalPaise)}</p>
          </div>
          <div className="rounded-lg border bg-muted/30 p-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Properties</p>
            <p className="mt-1 text-lg font-semibold tabular">{data.byProperty.length}</p>
          </div>
          <div className="rounded-lg border bg-muted/30 p-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Entries shown</p>
            <p className="mt-1 text-lg font-semibold tabular">{data.rows.length}</p>
          </div>
          <div className="rounded-lg border bg-muted/30 p-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Top category</p>
            <p className="mt-1 text-lg font-semibold">{data.byHead[0]?.head ?? "—"}</p>
          </div>
        </div>

        {/* Visual breakdown — by category, by property, monthly trend */}
        <ExpensesCharts data={data} />

        {/* By payment method (compact list — a mix people scan, not a headline chart) */}
        <div className="rounded-lg border p-3">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">By payment method</p>
          <ul className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            {data.byPaidVia.length === 0 ? <li className="text-muted-foreground">No approved spend.</li> :
              data.byPaidVia.map((p) => (
                <li key={p.paidVia} className="flex justify-between"><span>{payLabel(p.paidVia === "UNSPECIFIED" ? null : p.paidVia)}</span><span className="tabular font-medium">{formatINR(p.totalPaise)}</span></li>
              ))}
          </ul>
        </div>

        {/* Ledger */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Date</th>
                <th className="py-2 px-3 font-medium">Property</th>
                <th className="py-2 px-3 font-medium">Category</th>
                <th className="py-2 px-3 font-medium">Vendor</th>
                <th className="py-2 px-3 font-medium">Payment</th>
                <th className="py-2 px-3 font-medium">Status</th>
                <th className="py-2 px-3 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.length === 0 ? (
                <tr><td colSpan={7} className="py-8 text-center text-muted-foreground">No expenses match these filters.</td></tr>
              ) : data.rows.map((r) => (
                <tr key={r.id} className="border-b last:border-0 hover:bg-muted/40">
                  <td className="py-2.5 pr-3 whitespace-nowrap">{formatDayMonth(r.spentOn)}</td>
                  <td className="py-2.5 px-3 text-muted-foreground">{r.propertyName}</td>
                  <td className="py-2.5 px-3">{r.head}{r.subCategory ? <span className="text-muted-foreground"> · {r.subCategory}</span> : null}</td>
                  <td className="py-2.5 px-3 text-muted-foreground">{r.vendor ?? "—"}{r.hasBill ? " 📎" : ""}</td>
                  <td className="py-2.5 px-3">{payLabel(r.paidVia)}</td>
                  <td className="py-2.5 px-3">
                    <Badge variant={r.status === "APPROVED" ? "secondary" : r.status === "REJECTED" ? "destructive" : "outline"}>{r.status}</Badge>
                  </td>
                  <td className="py-2.5 px-3 text-right tabular font-medium">{formatINR(r.amountPaise)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
