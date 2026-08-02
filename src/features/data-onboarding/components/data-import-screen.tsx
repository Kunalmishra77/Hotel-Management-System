"use client";

/**
 * Data-import admin screen — 26 T-20/T-21 (AC-1/2/4/6/7/12). Upload → validate
 * (dry-run preview) → commit / rollback. Mobile-first, ≥44px actions. All rules
 * (RBAC, dedup, no-writes-on-dry-run) are enforced server-side; this UI only
 * surfaces status/action/reason and the errors/commit/rollback controls.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createBatch, validateBatch, commitBatch, rollbackBatch } from "../actions";
import type { BatchView, PreviewRow } from "../queries";

const KINDS = ["GUESTS", "RESERVATIONS", "BALANCES", "ROOMS", "STAFF"] as const;

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function DataImportScreen({
  propertyId,
  batches,
  selected,
  rows,
}: {
  propertyId: string | null;
  batches: BatchView[];
  selected: BatchView | null;
  rows: PreviewRow[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [kind, setKind] = useState<(typeof KINDS)[number]>("GUESTS");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canCommit = selected?.status === "VALIDATED" && selected.errorCount === 0 && selected.okCount > 0;

  const run = (fn: () => Promise<{ ok: boolean; error?: { message: string }; data?: unknown }>, onOk?: (data: unknown) => void) => {
    setError(null);
    start(async () => {
      const res = await fn();
      if (res.ok) { onOk?.(res.data); router.refresh(); }
      else setError(res.error?.message ?? "Something went wrong.");
    });
  };

  const upload = () => {
    if (!file) return;
    start(async () => {
      setError(null);
      try {
        const fileBase64 = await fileToBase64(file);
        const propertyForKind = kind === "GUESTS" || kind === "STAFF" ? undefined : propertyId ?? undefined;
        const res = await createBatch({ kind, fileName: file.name, fileBase64, propertyId: propertyForKind });
        if (res.ok) router.push(`/data-import?batch=${res.data.batchId}`);
        else setError(res.error?.message ?? "Upload failed.");
      } catch {
        setError("Could not read the file.");
      }
    });
  };

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 p-4">
      <h1 className="text-xl font-semibold">Data import</h1>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Upload</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <label htmlFor="import-kind" className="text-sm font-medium">Kind</label>
              <select id="import-kind" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}
                className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm" data-testid="import-kind">
                {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            </div>
            <a href={`/data-import/template?kind=${kind}`} className="inline-flex h-11 items-center rounded-md border px-4 text-sm" data-testid="import-template">
              Download template
            </a>
          </div>
          <input type="file" accept=".csv,.xlsx,.xls" onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm" data-testid="import-file" />
          {(kind === "RESERVATIONS" || kind === "BALANCES" || kind === "ROOMS") && !propertyId && (
            <p className="text-sm text-destructive">Select an active property for {kind} imports.</p>
          )}
          <Button size="lg" disabled={pending || !file} onClick={upload} data-testid="import-upload">Upload &amp; create batch</Button>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </CardContent>
      </Card>

      {selected && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              Batch {selected.kind} · {selected.status}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-4 text-sm" data-testid="import-summary">
              <span>Rows: {selected.rowCount}</span>
              <span className="text-green-700">OK: {selected.okCount}</span>
              <span className="text-destructive">Errors: {selected.errorCount}</span>
              <span className="text-amber-700">Duplicates: {selected.duplicateCount}</span>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button disabled={pending || selected.status === "COMMITTED"} onClick={() => run(() => validateBatch({ batchId: selected.id }))} data-testid="import-validate">
                Validate (dry-run)
              </Button>
              {selected.errorCount > 0 && (
                <a href={`/data-import/errors?batchId=${selected.id}`} className="inline-flex h-9 items-center rounded-md border px-3 text-sm" data-testid="import-download-errors">
                  Download errors
                </a>
              )}
              <Button disabled={pending || !canCommit} onClick={() => run(() => commitBatch({ batchId: selected.id }))} data-testid="import-commit">
                Commit
              </Button>
              <Button variant="outline" disabled={pending} onClick={() => run(() => rollbackBatch({ batchId: selected.id, reason: "admin rollback" }))} data-testid="import-rollback">
                Rollback
              </Button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="py-1 pr-3">#</th>
                    <th className="py-1 pr-3">Status</th>
                    <th className="py-1 pr-3">Action</th>
                    <th className="py-1 pr-3">Row</th>
                    <th className="py-1">Reason</th>
                  </tr>
                </thead>
                <tbody data-testid="import-preview">
                  {rows.map((r) => (
                    <tr key={r.rowNum} className="border-b">
                      <td className="py-1 pr-3">{r.rowNum}</td>
                      <td className="py-1 pr-3">{r.status}</td>
                      <td className="py-1 pr-3">{r.action}</td>
                      <td className="py-1 pr-3">{r.label}</td>
                      <td className="py-1 text-destructive">{r.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Recent batches</CardTitle></CardHeader>
        <CardContent className="space-y-1">
          {batches.length === 0 && <p className="text-sm text-muted-foreground">No import batches yet.</p>}
          {batches.map((b) => (
            <a key={b.id} href={`/data-import?batch=${b.id}`} className="flex justify-between rounded-md px-2 py-1.5 text-sm hover:bg-muted">
              <span>{b.kind} · {b.status}</span>
              <span className="text-muted-foreground">{b.rowCount} rows</span>
            </a>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
