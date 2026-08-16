import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/guard";
import { getBranding } from "@/features/subscription/queries";
import { BrandingForm } from "@/features/subscription/components/branding-form";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Branding" };

/** Super Admin · White-label branding (architecture v2 · SaaS). `settings:manage`. */
export default async function BrandingPage() {
  const user = await requirePermission("settings:manage");
  const branding = await getBranding(user.orgId);

  return (
    <div className="mx-auto w-full max-w-2xl px-1 py-1">
      <PageHeader title="Branding" description="Make the app yours — your name and accent colour." />
      <Card className="mt-2">
        <CardContent className="py-5">
          <BrandingForm brandName={branding?.brandName ?? ""} brandColor={branding?.brandColor ?? null} />
        </CardContent>
      </Card>
    </div>
  );
}
