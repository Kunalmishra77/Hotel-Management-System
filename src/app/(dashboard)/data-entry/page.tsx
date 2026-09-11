import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth/guard";
import { listAccessibleProperties } from "@/features/platform/actions";
import { HistoricalStayForm } from "@/features/reservations/components/historical-stay-form";
import { PageHeader } from "@/components/ui/page-header";

export const metadata: Metadata = { title: "Data Entry" };

/**
 * Data Entry — record a guest's PAST stay for a property (go-live onboarding).
 * Creates the guest + a CHECKED_OUT reservation with a folio/bill for the chosen
 * property and dates, so the stay shows in guest history, occupancy and revenue.
 * `reservation:create`, server-side.
 */
export default async function DataEntryPage() {
  await requirePermission("reservation:create");
  const properties = await listAccessibleProperties();

  return (
    <div className="mx-auto w-full max-w-3xl p-4">
      <PageHeader
        title="Data Entry — previous stays"
        description="Enter a guest's past stay for a property. Each saved stay appears under that property with its dates — in guest history, occupancy and revenue."
      />
      <p className="mb-4 text-sm text-muted-foreground">
        Have a spreadsheet of old records? Use <Link href="/data-import" className="text-primary underline underline-offset-4">Import &amp; Export</Link> for bulk upload. Use this form for one stay at a time.
      </p>
      <HistoricalStayForm properties={properties.map((p) => ({ id: p.id, name: p.name }))} />
    </div>
  );
}
