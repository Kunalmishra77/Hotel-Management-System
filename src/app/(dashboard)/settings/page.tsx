import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { Plug, ScrollText, ShieldCheck, Building2, Landmark, ArrowRight } from "lucide-react";
import { requirePermission } from "@/lib/auth/guard";
import { hasPermission } from "@/lib/permissions";
import { getOrgSecuritySettings } from "@/features/settings/queries";
import { SecuritySettingsForm } from "@/features/settings/components/security-settings-form";
import { COMPANY_INFO, COMPANY_BANK } from "@/lib/constants/company";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Settings" };

/**
 * 16 — the control room. Phase-3 ⑫: no longer a link-hub that duplicated the
 * Users and Properties nav items (that was the reported overlap). It now owns the
 * config that lives nowhere else — company profile, org security policy, audit and
 * integrations — and points at Users / Properties only as a "manage elsewhere" hint,
 * not as primary tiles. Gated server-side (FR-13); hiding nav is not security.
 */
export default async function SettingsPage() {
  const user = await requirePermission("settings:manage");
  const canUsers = hasPermission(user, "user:manage");
  const canIntegrations = hasPermission(user, "integration:manage");
  // Org-wide auth policy is Administrator-only (org-wide scope), even though a
  // property Manager also holds `settings:manage` for the hub below.
  const isOrgAdmin = user.propertyScope.kind === "ALL_IN_ORG";
  const settings = isOrgAdmin ? await getOrgSecuritySettings(user) : null;

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 p-4">
      <PageHeader title="Settings" description="Your control room — company profile, security, audit and integrations." />

      {/* Company profile — real, invoice-authoritative details (read-only here). */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base [&_svg]:size-4 [&_svg]:text-primary"><Building2 /> Company</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
          <Field label="Legal name" value={COMPANY_INFO.legalName} />
          <Field label="GSTIN" value={COMPANY_INFO.gstin} mono />
          <Field label="CIN" value={COMPANY_INFO.cin} mono />
          <Field label="State" value={`${COMPANY_INFO.stateName} (${COMPANY_INFO.stateCode})`} />
          <Field label="Registered office" value={COMPANY_INFO.regOfficeLines.join(" ")} />
          <Field label="Email" value={COMPANY_INFO.email} />
          <div className="sm:col-span-2 mt-1 flex items-start gap-2 rounded-md bg-muted/40 p-2.5 text-xs text-muted-foreground [&_svg]:mt-0.5 [&_svg]:size-3.5">
            <Landmark />
            <span>Bank on invoices — {COMPANY_BANK.bankName}, A/c {COMPANY_BANK.accountNo}, IFSC {COMPANY_BANK.ifsc}, {COMPANY_BANK.branch}. Per-property GST &amp; owner details are set under <Link href="/properties" className="font-medium text-primary hover:underline">Properties</Link>.</span>
          </div>
        </CardContent>
      </Card>

      {/* Org security policy (Administrator only). */}
      {settings ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base [&_svg]:size-4 [&_svg]:text-primary"><ShieldCheck /> Security policy</CardTitle>
          </CardHeader>
          <CardContent><SecuritySettingsForm settings={settings} /></CardContent>
        </Card>
      ) : null}

      {/* Config that has no other nav home. Users & Properties are top-level items,
          so they are not re-listed here — that was the overlap. */}
      <div className="grid gap-3 sm:grid-cols-2">
        {canUsers ? (
          <LinkCard href="/settings/audit" icon={<ScrollText />} title="Audit log" desc="Every business action, who and when" />
        ) : null}
        {canIntegrations ? (
          <LinkCard href="/settings/integrations" icon={<Plug />} title="Integrations" desc="Payment, messaging, OTA — sandbox &amp; live" />
        ) : null}
      </div>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-0.5 ${mono ? "font-mono text-[13px]" : ""}`}>{value}</p>
    </div>
  );
}

function LinkCard({ href, icon, title, desc }: { href: string; icon: ReactNode; title: string; desc: string }) {
  return (
    <Link href={href} className="group flex items-start gap-3 rounded-lg border border-border p-3.5 transition-colors hover:border-primary/50 hover:bg-muted/30">
      <span className="grid size-8 shrink-0 place-items-center rounded-md bg-primary/10 text-primary [&_svg]:size-4">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1 text-sm font-medium">{title} <ArrowRight className="size-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5" /></span>
        <span className="block text-xs text-muted-foreground">{desc}</span>
      </span>
    </Link>
  );
}
