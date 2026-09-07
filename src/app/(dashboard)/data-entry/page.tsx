import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/guard";
import { DataEntryForm } from "@/features/guests/components/data-entry-form";
import { PageHeader } from "@/components/ui/page-header";

export const metadata: Metadata = { title: "Data Entry" };

/**
 * Data Entry (26 objective) — turn existing paper records into real data. Capture
 * the record's photo, optionally AI-assist from its text, review, and save the
 * guest. `guest:create`, server-side.
 */
export default async function DataEntryPage() {
  await requirePermission("guest:create");
  return (
    <div className="mx-auto w-full max-w-2xl p-4">
      <PageHeader
        title="Data Entry"
        description="Capture existing records — photograph the document, review the details, and save. Replaces demo data with your real business data over time."
      />
      <DataEntryForm />
    </div>
  );
}
