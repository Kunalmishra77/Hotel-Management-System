import type { Metadata } from "next";
import Link from "next/link";
import { ScrollText } from "lucide-react";
import { requirePermission } from "@/lib/auth/guard";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { UsersManager } from "@/features/users/components/users-manager";
import { listOrgProperties, listUsers } from "@/features/users/queries";

export const metadata: Metadata = { title: "Users & Access" };

export default async function UsersPage() {
  // FR-13: enforced server-side — hiding the nav item is not security.
  await requirePermission("user:manage");

  const [users, properties] = await Promise.all([listUsers(), listOrgProperties()]);

  return (
    <>
      <Breadcrumb
        items={[{ label: "Home", href: "/dashboard" }, { label: "Settings" }, { label: "Users & Access" }]}
        className="mb-3"
      />
      <PageHeader
        title="Users & Access"
        description="Create staff accounts and control what each role can do, per property."
        actions={
          <Button asChild variant="outline">
            <Link href="/settings/audit">
              <ScrollText /> Audit log
            </Link>
          </Button>
        }
      />
      <UsersManager users={users} properties={properties} />
    </>
  );
}
