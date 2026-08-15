import type { Metadata } from "next";
import Link from "next/link";
import { ShieldCheck, Building2, BadgeCheck } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { resolvePortal } from "@/features/platform/portals";
import { ChangePasswordForm } from "@/features/auth/components/change-password-form";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "My profile" };

const ROLE_LABEL: Record<string, string> = {
  ADMINISTRATOR: "Administrator", MANAGER: "Manager", ASSISTANT_MANAGER: "Assistant Manager",
  RECEPTION: "Reception", ACCOUNTS: "Accounts", HR: "HR", INVENTORY_MANAGER: "Inventory Manager",
  PURCHASE_MANAGER: "Purchase Manager", POS_MANAGER: "Outlet (POS)", HOUSEKEEPING: "Housekeeping",
  MAINTENANCE: "Maintenance", SECURITY_SUPERVISOR: "Security", LAUNDRY_SUPERVISOR: "Laundry", OWNER: "Owner",
};
const PORTAL_LABEL: Record<string, string> = {
  SUPER_ADMIN: "Super Admin", OWNER: "Owner", MANAGER: "Manager", RECEPTION: "Reception",
  ACCOUNTS: "Accounts", HOUSEKEEPING: "Housekeeping", MAINTENANCE: "Maintenance", OUTLET: "Outlet", STORE: "Store",
};
const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("") || "U";

/**
 * My Profile (architecture v2 · Phase 7). The one personal-account page every role
 * gets, reached from the header user menu: identity, roles + portal, password
 * change, and a link to security (2FA). Personal only — no other user's data.
 */
export default async function ProfilePage() {
  const user = await requireUser();
  const roles = user.roleAssignments.map((r) => r.role);
  const portal = resolvePortal(roles);

  return (
    <div className="mx-auto w-full max-w-2xl px-1 py-1">
      <PageHeader title="My profile" description="Your account, access, and password." />

      <Card className="mt-2">
        <CardContent className="flex items-center gap-4 py-5">
          <Avatar className="size-14">
            <AvatarFallback className="text-lg">{initials(user.name)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="text-lg font-semibold">{user.name}</p>
            <p className="truncate text-sm text-muted-foreground">{user.email}</p>
            {portal ? (
              <p className="mt-1 inline-flex items-center gap-1 text-xs text-primary">
                <BadgeCheck className="size-3.5" aria-hidden="true" /> {PORTAL_LABEL[portal]} portal
              </p>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Roles</CardTitle></CardHeader>
          <CardContent>
            <ul className="flex flex-wrap gap-1.5">
              {roles.map((r) => (
                <li key={r} className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium">{ROLE_LABEL[r] ?? r}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Property access</CardTitle></CardHeader>
          <CardContent>
            <p className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
              <Building2 className="size-4" aria-hidden="true" />
              {user.propertyScope.kind === "ALL_IN_ORG"
                ? "All properties (org-wide)"
                : `${user.accessiblePropertyIds.length} propert${user.accessiblePropertyIds.length === 1 ? "y" : "ies"}`}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader className="pb-2"><CardTitle className="text-base">Change password</CardTitle></CardHeader>
        <CardContent><ChangePasswordForm /></CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><ShieldCheck className="size-4 text-primary" aria-hidden="true" /> Two-factor authentication</CardTitle></CardHeader>
        <CardContent className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">Manage 2FA and backup codes in Security.</p>
          <Button asChild variant="outline" size="sm"><Link href="/settings/security">Open Security</Link></Button>
        </CardContent>
      </Card>
    </div>
  );
}
