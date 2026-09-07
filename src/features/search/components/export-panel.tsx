"use client";

/**
 * Per-entity export panel for the Data hub (15 FR-4/5). Each row exports a whole
 * entity set — customers, bookings, billing, expenses, staff — to Excel / CSV /
 * PDF via the canonical `exportSearch` (server-side `export:data`, PII gated by
 * `export:pii`). Large sets queue; otherwise the file downloads immediately.
 * Rooms/services live in their own modules and aren't part of the search index.
 */
import { useState } from "react";
import { Users, CalendarRange, ReceiptText, Wallet, IdCard } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { exportSearch, type ExportResult } from "../actions";
import type { EntityKind } from "../types";
import type { ExportFormat } from "../export-format";

const ENTITIES: { kind: EntityKind; label: string; hint: string; icon: React.ReactNode }[] = [
  { kind: "guest", label: "Customers", hint: "Guest CRM records", icon: <Users className="size-4" /> },
  { kind: "reservation", label: "Bookings", hint: "Reservations", icon: <CalendarRange className="size-4" /> },
  { kind: "invoice", label: "Billing", hint: "GST invoices", icon: <ReceiptText className="size-4" /> },
  { kind: "expense", label: "Expenses", hint: "Expense entries", icon: <Wallet className="size-4" /> },
  { kind: "staff", label: "Staff", hint: "Staff records", icon: <IdCard className="size-4" /> },
];

const FORMATS: { key: ExportFormat; label: string }[] = [
  { key: "xlsx", label: "Excel" },
  { key: "csv", label: "CSV" },
  { key: "pdf", label: "PDF" },
];

export function ExportPanel() {
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function run(kind: EntityKind, format: ExportFormat) {
    setBusy(`${kind}:${format}`);
    setMsg(null);
    const res = await exportSearch({ entities: [kind], format });
    setBusy(null);
    if (!res.ok) { setMsg(res.error.message); return; }
    const data = res.data as ExportResult;
    if (data.status === "QUEUED") {
      setMsg("Large export — preparing. It will appear in your exports shortly.");
      return;
    }
    window.location.href = `/api/exports/${data.jobId}`;
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        {ENTITIES.map((e) => (
          <Card key={e.kind}>
            <CardContent className="flex items-center justify-between gap-3 p-3.5">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="grid size-9 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">{e.icon}</span>
                <div className="min-w-0">
                  <p className="text-sm font-medium">{e.label}</p>
                  <p className="truncate text-xs text-muted-foreground">{e.hint}</p>
                </div>
              </div>
              <div className="flex shrink-0 gap-1.5">
                {FORMATS.map((f) => (
                  <Button key={f.key} size="sm" variant="outline" disabled={busy !== null}
                    onClick={() => run(e.kind, f.key)} data-testid={`export-${e.kind}-${f.key}`}>
                    {busy === `${e.kind}:${f.key}` ? "…" : f.label}
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      {msg && <p className="text-sm text-muted-foreground" data-testid="export-panel-msg">{msg}</p>}
      <p className="text-xs text-muted-foreground">
        Exports are access-controlled and audited. Personal data (mobile, email) is included only if you hold the PII-export permission.
      </p>
    </div>
  );
}
