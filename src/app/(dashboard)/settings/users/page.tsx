import type { Metadata } from "next";
import { ModulePlaceholder } from "@/features/platform/components/module-placeholder";
import { requirePermission } from "@/lib/auth/guard";

export const metadata: Metadata = { title: "Users & Access" };

export default async function UsersPage() {
  // FR-13: enforced server-side — hiding the nav item is not security.
  await requirePermission("user:manage");

  return (
    <ModulePlaceholder
      title="Users & Access"
      module="16-access-control-security"
      summary="User administration, role assignment, permission overrides and the audit browser."
    />
  );
}
