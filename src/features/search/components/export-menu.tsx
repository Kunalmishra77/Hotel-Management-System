"use client";

/**
 * 15 T-10 — export menu (FR-4/5, AC-4/5). Permission-aware: only rendered when
 * the caller holds `export:data`. On success it navigates to the access-controlled
 * download route. PII gating happens server-side (export:pii) — this UI never
 * decides it.
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { exportSearch, type ExportResult } from "../actions";
import type { ExportFormat } from "../export-format";

const FORMATS: { key: ExportFormat; label: string }[] = [
  { key: "xlsx", label: "Excel" },
  { key: "pdf", label: "PDF" },
  { key: "csv", label: "CSV" },
];

export function ExportMenu({ keyword }: { keyword: string }) {
  const [busy, setBusy] = useState<ExportFormat | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function run(format: ExportFormat) {
    setBusy(format);
    setMsg(null);
    const res = await exportSearch({ keyword, format });
    setBusy(null);
    if (!res.ok) {
      setMsg(res.error.message);
      return;
    }
    const data = res.data as ExportResult;
    if (data.status === "QUEUED") {
      setMsg("Large export — preparing. You'll find it in your exports shortly.");
      return;
    }
    window.location.href = `/api/exports/${data.jobId}`;
  }

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="export-menu">
      <span className="text-sm text-muted-foreground">Export:</span>
      {FORMATS.map((f) => (
        <Button key={f.key} size="sm" variant="outline" disabled={busy !== null} onClick={() => run(f.key)} data-testid={`export-${f.key}`}>
          {busy === f.key ? "…" : f.label}
        </Button>
      ))}
      {msg && <p className="w-full text-sm text-muted-foreground" data-testid="export-msg">{msg}</p>}
    </div>
  );
}
