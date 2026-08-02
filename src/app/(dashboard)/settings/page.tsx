import type { Metadata } from "next";
import { ModulePlaceholder } from "@/features/platform/components/module-placeholder";
import { requirePermission } from "@/lib/auth/guard";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  // FR-13: enforced server-side — hiding the nav item is not security.
  await requirePermission("settings:manage");

  return (
    <ModulePlaceholder
      title="Settings"
      module="16-access-control-security"
      summary="Organisation, property and security configuration."
    />
  );
}
