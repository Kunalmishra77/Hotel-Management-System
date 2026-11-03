"use client";

/**
 * "View" popup for one expense — what it was, how much, where, paid how, the
 * vendor / GSTIN, who entered it and who approved or rejected it (and why), and
 * the bill scan when one was attached. Opened from the approval queue, the
 * date-wise parchis and the ledger. Optional approve / reject buttons for a
 * pending expense so an approver decides with the details in front of them.
 */
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatINR } from "@/lib/utils";
import { EXPENSE_HEAD_LABEL, PAYMENT_MODE_LABEL } from "@/lib/constants/company";
import { getExpenseDetail, type ExpenseDetail } from "../detail-action";

const fmtDate = (ymd: string) => new Date(`${ymd}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
const fmtTime = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });
const statusText = (s: string) => (s === "DRAFT" ? "Pending approval" : s === "APPROVED" ? "Approved" : s === "REJECTED" ? "Rejected" : s);

export function ExpenseDetailDialog({
  expenseId,
  onClose,
  onApprove,
  onReject,
}: {
  expenseId: string | null;
  onClose: () => void;
  onApprove?: (id: string) => void;
  onReject?: (id: string) => void;
}) {
  const [detail, setDetail] = useState<ExpenseDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDetail(null);
    setError(null);
    if (!expenseId) return;
    let live = true;
    getExpenseDetail(expenseId).then((r) => {
      if (!live) return;
      if (r.ok) setDetail(r.data);
      else setError(r.error.message);
    });
    return () => { live = false; };
  }, [expenseId]);

  useEffect(() => {
    if (!expenseId) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expenseId, onClose]);

  if (!expenseId) return null;
  const pending = detail?.status === "DRAFT";

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/40" />
      <div role="dialog" aria-modal="true" aria-label="Expense details" className="relative max-h-[90vh] w-full overflow-y-auto rounded-t-xl border bg-background p-4 shadow-lg sm:max-w-lg sm:rounded-xl" data-testid="expense-detail">
        <div className="mb-3 flex items-start justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold">{detail ? (detail.description || detail.subCategory || EXPENSE_HEAD_LABEL[detail.head] || detail.head) : "Expense"}</h2>
            {detail && <p className="text-sm text-muted-foreground">{fmtDate(detail.spentOn)} · {detail.propertyName}</p>}
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close"><X className="size-4" /></Button>
        </div>

        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {!detail && !error && <p className="text-sm text-muted-foreground">Loading…</p>}

        {detail && (
          <div className="space-y-4">
            <p className="text-2xl font-semibold tabular-nums">{formatINR(detail.amountPaise)}</p>
            <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1.5 text-sm">
              <dt className="text-muted-foreground">Item</dt><dd>{detail.description || "—"}</dd>
              <dt className="text-muted-foreground">Quantity</dt><dd>{detail.quantity || "—"}</dd>
              <dt className="text-muted-foreground">Category</dt><dd>{EXPENSE_HEAD_LABEL[detail.head] ?? detail.head}{detail.subCategory ? ` · ${detail.subCategory}` : ""}</dd>
              <dt className="text-muted-foreground">Paid via</dt><dd>{detail.paidVia ? (PAYMENT_MODE_LABEL[detail.paidVia as keyof typeof PAYMENT_MODE_LABEL] ?? detail.paidVia) : "—"}</dd>
              <dt className="text-muted-foreground">Vendor</dt><dd>{detail.vendor || "—"}</dd>
              <dt className="text-muted-foreground">GSTIN</dt><dd className="font-mono">{detail.gstNumber || "—"}</dd>
              <dt className="text-muted-foreground">Status</dt>
              <dd className={detail.status === "DRAFT" ? "font-medium text-amber-700 dark:text-amber-400" : detail.status === "REJECTED" ? "font-medium text-destructive" : "font-medium text-emerald-700 dark:text-emerald-400"}>
                {statusText(detail.status)}
                {detail.approvedBy && detail.status !== "DRAFT" ? ` by ${detail.approvedBy}` : ""}
                {detail.decidedAt && detail.status !== "DRAFT" ? ` · ${fmtTime(detail.decidedAt)}` : ""}
              </dd>
              {detail.rejectReason && (<><dt className="text-muted-foreground">Reject reason</dt><dd>{detail.rejectReason}</dd></>)}
              <dt className="text-muted-foreground">Entered by</dt><dd>{detail.createdBy ?? "—"} · {fmtTime(detail.createdAt)}</dd>
            </dl>

            {detail.hasBill ? (
              <div className="space-y-1">
                <p className="text-sm font-medium">Bill</p>
                <a href={`/api/expenses/${detail.id}/bill`} target="_blank" rel="noopener noreferrer" className="block">
                  {/* eslint-disable-next-line @next/next/no-img-element -- authenticated private scan, not a static asset */}
                  <img src={`/api/expenses/${detail.id}/bill`} alt="Bill scan" className="max-h-80 w-full rounded-md border object-contain" />
                </a>
                <p className="text-xs text-muted-foreground">Tap the bill to open it full size.</p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No bill photo attached.</p>
            )}

            {pending && (onApprove || onReject) && (
              <div className="flex gap-2 border-t pt-3">
                {onApprove && <Button onClick={() => onApprove(detail.id)} data-testid="detail-approve">Approve</Button>}
                {onReject && <Button variant="outline" onClick={() => onReject(detail.id)} data-testid="detail-reject">Reject</Button>}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
