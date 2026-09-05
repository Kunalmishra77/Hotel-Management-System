import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/guard";
import { getGuestForEdit } from "@/features/guests/queries";
import { EditGuestForm } from "@/features/guests/components/edit-guest-form";
import { PageHeader } from "@/components/ui/page-header";

export const metadata: Metadata = { title: "Edit guest" };

/**
 * 04 FR-2 — edit any guest detail, including AFTER check-in (a guest is a
 * permanent record, not gated by reservation status). `guest:manage`, server-side.
 */
export default async function EditGuestPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("guest:manage");
  const { id } = await params;
  const guest = await getGuestForEdit(user, id);
  if (!guest) notFound();

  return (
    <div className="mx-auto w-full max-w-2xl p-4">
      <PageHeader title={`Edit ${guest.fullName}`} description="Correct any detail — this works even after check-in." />
      <EditGuestForm guest={guest} />
    </div>
  );
}
