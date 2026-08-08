import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { Building2, Plug, ScrollText, ShieldCheck, Users } from "lucide-react";
import { requirePermission } from "@/lib/auth/guard";
import { hasPermission } from "@/lib/permissions";
import { getOrgSecuritySettings } from "@/features/settings/queries";
import { SecuritySettingsForm } from "@/features/settings/components/security-settings-form";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Settings" };

/** 16 — the org admin home: quick links + the security-policy editor. Gated
 *  server-side (FR-13); hiding the nav item is not security. */
export default async function SettingsPage() {
  const user = await requirePermission("settings:manage");
  const canUsers = hasPermission(user, "user:manage");
  const canIntegrations = hasPermission(user, "integration:manage");
  // Org-wide auth policy is Administrator-only (org-wide scope), even though a
  // property Manager also holds `settings:manage` for the hub links below.
  const isOrgAdmin = user.propertyScope.kind === "ALL_IN_ORG";
  const settings = isOrgAdmin ? await getOrgSecuritySettings(user) : null;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <PageHeader title="Organization settings" description="Users, properties, audit, and security policy." />

      <div className="grid gap-3 sm:grid-cols-3">
        {canUsers ? (
          <LinkCard href="/settings/users" icon={<Users />} title="Users & roles" desc="Create users, assign roles" />
        ) : null}
        {canUsers ? (
          <LinkCard href="/settings/audit" icon={<ScrollText />} title="Audit log" desc="Every business action" />
        ) : null}
        <LinkCard href="/properties" icon={<Building2 />} title="Properties" desc="Add and edit properties" />
        {canIntegrations ? (
          <LinkCard
            href="/settings/integrations"
            icon={<Plug />}
            title="Integrations"
            desc="Providers, sandbox and live"
          />
        ) : null}
      </div>

      {settings ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base [&_svg]:size-4 [&_svg]:text-primary">
              <ShieldCheck /> Security policy
            </CardTitle>
          </CardHeader>
          <CardContent>
            <SecuritySettingsForm settings={settings} />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function LinkCard({ href, icon, title, desc }: { href: string; icon: ReactNode; title: string; desc: string }) {
  return (
    <Link
      href={href}
      className="rounded-lg border border-border p-3.5 transition-colors hover:border-primary/50 hover:bg-muted/30"
    >
      <span className="grid size-8 place-items-center rounded-md bg-primary/10 text-primary [&_svg]:size-4">{icon}</span>
      <p className="mt-2 text-sm font-medium">{title}</p>
      <p className="text-xs text-muted-foreground">{desc}</p>
    </Link>
  );
}
