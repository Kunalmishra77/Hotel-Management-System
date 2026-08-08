import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/guard";
import { getIntegrationsOverview } from "@/features/integrations/queries";
import { IntegrationsConsole } from "@/features/integrations/components/integrations-console";
import { PageHeader } from "@/components/ui/page-header";

export const metadata: Metadata = { title: "Integrations" };

/** 16 — org-admin integrations status board. `integration:manage` is
 *  Administrator-only, enforced server-side (security.md). */
export default async function IntegrationsSettingsPage() {
  const user = await requirePermission("integration:manage");
  const overview = await getIntegrationsOverview(user);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <PageHeader
        title="Integrations"
        description="Sandbox and live status across every external provider — and the blocker each must clear to go live."
      />
      <IntegrationsConsole overview={overview} />
    </div>
  );
}
