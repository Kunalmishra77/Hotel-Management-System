import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/guard";
import { can } from "@/lib/permissions";
import { listOwnerDocuments } from "@/features/owner-portal/queries";
import { DocumentVault } from "@/features/owner-portal/components/document-vault";

export const metadata: Metadata = { title: "Documents" };

/** 27 owner-portal — property document vault. owner:view-docs (or owner:manage). */
export default async function OwnerDocumentsPage() {
  const user = await requirePermission("owner:view-docs");
  const propertyId = user.activePropertyId;

  if (!propertyId) {
    return (
      <div className="p-4">
        <p className="text-sm text-muted-foreground">Select a property to see its documents.</p>
      </div>
    );
  }

  const documents = await listOwnerDocuments(user, { propertyId });
  const canUpload = can(user, "owner:upload-docs", propertyId) || can(user, "owner:manage", propertyId);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 p-4">
      <div>
        <h1 className="text-xl font-semibold">Documents</h1>
        <p className="text-sm text-muted-foreground">Agreements, licences, tax papers and statements for your property.</p>
      </div>
      <DocumentVault propertyId={propertyId} documents={documents} canUpload={canUpload} />
    </div>
  );
}
