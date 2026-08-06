import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/guard";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { PageHeader } from "@/components/ui/page-header";
import { AuditBrowser } from "@/features/audit/components/audit-browser";
import { getAuditPage } from "@/features/audit/queries";

export const metadata: Metadata = { title: "Audit log" };

export default async function AuditPage() {
  await requirePermission("user:manage");
  const first = await getAuditPage({});

  return (
    <>
      <Breadcrumb
        items={[{ label: "Home", href: "/dashboard" }, { label: "Settings" }, { label: "Audit log" }]}
        className="mb-3"
      />
      <PageHeader
        title="Audit log"
        description="Every business action — who did what, when. Immutable and append-only."
      />
      <AuditBrowser initial={first.rows} initialCursor={first.nextCursor} />
    </>
  );
}
