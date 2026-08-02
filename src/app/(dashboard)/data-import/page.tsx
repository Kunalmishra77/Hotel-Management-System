import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/guard";
import { getBatch, getBatchRows, listBatches } from "@/features/data-onboarding/queries";
import { DataImportScreen } from "@/features/data-onboarding/components/data-import-screen";

export const metadata: Metadata = { title: "Data import" };

/** 26 T-20/T-21 — go-live import: upload → validate (dry-run) → commit/rollback. */
export default async function DataImportPage({
  searchParams,
}: {
  searchParams: Promise<{ batch?: string }>;
}) {
  const user = await requirePermission("data:import", null);
  const { batch: batchId } = await searchParams;

  const batches = await listBatches(user, 25);
  const selected = batchId ? await getBatch(user, batchId).catch(() => null) : null;
  const rows = selected ? await getBatchRows(user, selected.id) : [];

  return (
    <DataImportScreen
      propertyId={user.activePropertyId}
      batches={batches}
      selected={selected}
      rows={rows}
    />
  );
}
