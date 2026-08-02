import type { Metadata } from "next";
import { hasPermission } from "@/lib/permissions";
import { requirePermission } from "@/lib/auth/guard";
import {
  listDynamicRates,
  listCategoriesWithGuardrails,
  type CategoryGuardrail,
} from "@/features/dynamic-pricing/queries";
import { PricingScreen } from "@/features/dynamic-pricing/components/pricing-screen";

export const metadata: Metadata = { title: "Pricing" };

/** 24 T-9 — dynamic-rate calendar + approve/adjust within guardrails (AC-1/2/3). */
export default async function PricingPage({
  searchParams,
}: {
  searchParams: Promise<{ cat?: string }>;
}) {
  // FR-6 — server-side gate; hiding the nav item is cosmetic (security.md).
  const user = await requirePermission("pricing:approve");
  const propertyId = user.activePropertyId;
  if (!propertyId) {
    return (
      <div className="p-4">
        <p className="text-sm text-muted-foreground">Select a property to manage pricing.</p>
      </div>
    );
  }

  const categories = await listCategoriesWithGuardrails(user, propertyId);
  const { cat } = await searchParams;
  const selected: CategoryGuardrail | null =
    categories.find((c) => c.id === cat) ?? categories[0] ?? null;

  // A rolling 14-day window keeps the mobile calendar scannable.
  const todayStr = new Date().toISOString().slice(0, 10);
  const from = new Date(`${todayStr}T00:00:00.000Z`);
  const to = new Date(from);
  to.setUTCDate(to.getUTCDate() + 13);

  const rates = selected
    ? await listDynamicRates(user, { propertyId, roomCategoryId: selected.id, from, to })
    : [];

  return (
    <PricingScreen
      categories={categories}
      selectedCategoryId={selected?.id ?? ""}
      guardrail={selected}
      rates={rates}
      canApprove={hasPermission(user, "pricing:approve")}
    />
  );
}
