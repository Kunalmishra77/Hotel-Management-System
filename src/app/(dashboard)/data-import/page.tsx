import type { Metadata } from "next";
import { Download, Upload } from "lucide-react";
import { requirePermission } from "@/lib/auth/guard";
import { hasPermission } from "@/lib/permissions";
import { getBatch, getBatchRows, listBatches } from "@/features/data-onboarding/queries";
import { DataImportScreen } from "@/features/data-onboarding/components/data-import-screen";
import { ExportPanel } from "@/features/search/components/export-panel";
import { PageHeader } from "@/components/ui/page-header";

export const metadata: Metadata = { title: "Data · Import & Export" };

/**
 * Data hub — one place for both directions (26 import + 15 export).
 * Import: upload → validate (dry-run) → commit/rollback. Export: per-entity
 * Excel/CSV/PDF. Route gated by `data:import`; the export block also needs
 * `export:data`.
 */
export default async function DataHubPage({
  searchParams,
}: {
  searchParams: Promise<{ batch?: string }>;
}) {
  const user = await requirePermission("data:import", null);
  const { batch: batchId } = await searchParams;

  const batches = await listBatches(user, 25);
  const selected = batchId ? await getBatch(user, batchId).catch(() => null) : null;
  const rows = selected ? await getBatchRows(user, selected.id) : [];
  const canExport = hasPermission(user, "export:data");

  return (
    <div className="mx-auto w-full max-w-5xl">
      <PageHeader title="Data — Import & Export" description="Bring existing records in, or take your data out — in one place." />

      {canExport && (
        <section className="mb-8">
          <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            <Download className="size-4" /> Export
          </h2>
          <p className="mb-3 text-sm text-muted-foreground">Download a whole entity as Excel, CSV, or PDF.</p>
          <ExportPanel />
        </section>
      )}

      <section>
        <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          <Upload className="size-4" /> Import
        </h2>
        <p className="mb-3 text-sm text-muted-foreground">
          Upload a CSV/Excel file, validate it as a dry-run, then commit — or roll back. Guests, bookings, opening balances, rooms, staff.
        </p>
        <DataImportScreen propertyId={user.activePropertyId} batches={batches} selected={selected} rows={rows} />
      </section>
    </div>
  );
}
