"use client";

/**
 * Form C / FRRO register — 03 T-37 (FR-25/26). Mobile-first card list of a
 * property's foreign-guest C-Forms. Reception/Manager can record an e-FRRO
 * submission reference (GENERATED → SUBMITTED); everyone with `reservation:view`
 * can download the generated PDF. No passport/visa number is ever shown here —
 * the server never sends one (compliance.md).
 */
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Download, FileCheck2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { markCFormSubmitted } from "../cform-actions";
import type { CFormListItem } from "../queries";

function fmt(d: Date): string {
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function StatusBadge({ status }: { status: string }) {
  const submitted = status === "SUBMITTED";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
        submitted ? "bg-success/12 text-success" : "bg-warning/12 text-warning"
      }`}
      data-testid="cform-status"
    >
      {submitted ? "Submitted" : "Generated"}
    </span>
  );
}

function CFormCard({ item, canSubmit }: { item: CFormListItem; canSubmit: boolean }) {
  const [status, setStatus] = useState(item.status);
  const [ref, setRef] = useState(item.submissionRef ?? "");
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();

  function record() {
    const submissionRef = ref.trim();
    if (!submissionRef) {
      toast.error("Enter the FRRO submission reference.");
      return;
    }
    startTransition(async () => {
      const res = await markCFormSubmitted({ cformId: item.id, submissionRef });
      if (res.ok) {
        setStatus(res.data.status);
        setRef(res.data.submissionRef);
        setEditing(false);
        toast.success("FRRO submission recorded.");
      } else {
        toast.error(res.error.message);
      }
    });
  }

  return (
    <li className="rounded-lg border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium">{item.guestName}</p>
          <p className="text-sm text-muted-foreground">
            {item.nationality} · {item.reservationCode}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {fmt(item.checkInDate)} → {fmt(item.checkOutDate)}
          </p>
        </div>
        <StatusBadge status={status} />
      </div>

      {status === "SUBMITTED" && ref ? (
        <p className="mt-2 text-xs text-muted-foreground" data-testid="cform-ref">
          FRRO ref: <span className="font-mono">{ref}</span>
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {item.hasPdf ? (
          <Button asChild variant="outline" size="sm">
            <a href={`/bookings/form-c/${item.id}`} data-testid="cform-download">
              <Download className="size-4" /> PDF
            </a>
          </Button>
        ) : null}

        {canSubmit && status !== "SUBMITTED" && !editing ? (
          <Button variant="outline" size="sm" onClick={() => setEditing(true)} data-testid="cform-record-open">
            <Send className="size-4" /> Record submission
          </Button>
        ) : null}
      </div>

      {canSubmit && editing ? (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1">
            <label htmlFor={`ref-${item.id}`} className="text-xs text-muted-foreground">
              e-FRRO submission reference
            </label>
            <Input
              id={`ref-${item.id}`}
              value={ref}
              onChange={(e) => setRef(e.target.value)}
              placeholder="e.g. FRRO-2026-000123"
              maxLength={64}
              data-testid="cform-ref-input"
            />
          </div>
          <Button size="sm" onClick={record} disabled={pending} data-testid="cform-record-save">
            {pending ? "Saving…" : "Save"}
          </Button>
        </div>
      ) : null}
    </li>
  );
}

export function FormCRegister({ items, canSubmit }: { items: CFormListItem[]; canSubmit: boolean }) {
  if (items.length === 0) {
    return (
      <EmptyState
        icon={<FileCheck2 />}
        title="No Form C records yet"
        description="A Form C is generated during check-in for guests with a passport or visa on file."
      />
    );
  }
  return (
    <ul className="space-y-3" data-testid="cform-register">
      {items.map((item) => (
        <CFormCard key={item.id} item={item} canSubmit={canSubmit} />
      ))}
    </ul>
  );
}
