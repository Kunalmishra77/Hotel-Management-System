/**
 * Data-onboarding queries — 26 (FR-2/7). Template download, error-report CSV, and
 * the batch/preview views the admin screen reads. Callers pass claims explicitly
 * (layering, as in 01/02/08). PII discipline: the preview shows the row's name +
 * MASKED mobile only — never the full contact or Aadhaar (compliance.md).
 */
import { templateCsv } from "./domain/templates";
import { maskAadhaar } from "./domain/normalize";
import { importDb, loadBatch } from "./internal";
import type { ImportKindName } from "./domain/validate";
import type { SessionClaims } from "@/lib/auth/claims";

export type TemplateFile = { fileName: string; contentType: string; content: string };

/** The downloadable per-kind template (headers + one example row). (AC-1) */
export function getTemplate(kind: ImportKindName): TemplateFile {
  return {
    fileName: `woodpecker-import-${kind.toLowerCase()}.csv`,
    contentType: "text/csv; charset=utf-8",
    content: templateCsv(kind),
  };
}

/** Error report: exactly the ERROR rows with rowNum + reason. (FR-7, AC-6) */
export async function downloadErrors(user: SessionClaims, batchId: string): Promise<TemplateFile> {
  const batch = await loadBatch(user.orgId, batchId);
  const rows = await importDb().importRow.findMany({
    where: { batchId: batch.id, status: "ERROR" },
    orderBy: { rowNum: "asc" },
    select: { rowNum: true, error: true },
  });
  const csvField = (s: string) => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const lines = ["row,reason"];
  for (const r of rows) lines.push(`${r.rowNum},${csvField(r.error ?? "")}`);
  return {
    fileName: `import-errors-${batch.id}.csv`,
    contentType: "text/csv; charset=utf-8",
    content: lines.join("\r\n") + "\r\n",
  };
}

export type BatchView = {
  id: string;
  kind: string;
  status: string;
  propertyId: string | null;
  rowCount: number;
  okCount: number;
  errorCount: number;
  duplicateCount: number;
  createdAt: Date;
  committedAt: Date | null;
};

export async function getBatch(user: SessionClaims, batchId: string): Promise<BatchView> {
  const b = await loadBatch(user.orgId, batchId);
  return {
    id: b.id, kind: b.kind, status: b.status, propertyId: b.propertyId,
    rowCount: b.rowCount, okCount: b.okCount, errorCount: b.errorCount,
    duplicateCount: b.duplicateCount, createdAt: b.createdAt, committedAt: b.committedAt,
  };
}

export async function listBatches(user: SessionClaims, limit = 50): Promise<BatchView[]> {
  const rows = await importDb().importBatch.findMany({
    where: { orgId: user.orgId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return rows.map((b) => ({
    id: b.id, kind: b.kind, status: b.status, propertyId: b.propertyId,
    rowCount: b.rowCount, okCount: b.okCount, errorCount: b.errorCount,
    duplicateCount: b.duplicateCount, createdAt: b.createdAt, committedAt: b.committedAt,
  }));
}

export type PreviewRow = {
  rowNum: number;
  status: string;
  action: string;
  reason: string | null;
  /** PII-safe label: name + masked mobile only. */
  label: string;
};

/** The dry-run preview table (status/action/reason per row). (AC-4) */
export async function getBatchRows(
  user: SessionClaims,
  batchId: string,
  limit = 500,
): Promise<PreviewRow[]> {
  const batch = await loadBatch(user.orgId, batchId);
  const rows = await importDb().importRow.findMany({
    where: { batchId: batch.id },
    orderBy: { rowNum: "asc" },
    take: limit,
    select: { rowNum: true, status: true, action: true, error: true, raw: true },
  });
  return rows.map((r) => {
    const raw = (r.raw ?? {}) as Record<string, string>;
    return {
      rowNum: r.rowNum,
      status: r.status,
      action: r.action,
      reason: r.error,
      label: piiSafeLabel(raw),
    };
  });
}

function piiSafeLabel(raw: Record<string, string>): string {
  const name = (raw.fullName ?? "").trim();
  const mobile = (raw.mobile ?? "").replace(/\D/g, "");
  const masked = mobile.length >= 4 ? `••••${mobile.slice(-4)}` : "";
  // Aadhaar, if present, is only ever shown masked — never the full value.
  const aadhaar = raw.aadhaar ? ` · ${maskAadhaar(raw.aadhaar)}` : "";
  return [name, masked].filter(Boolean).join(" · ") + aadhaar;
}

export type ImportKindOption = ImportKindName;
