import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AskPms } from "@/features/ai/components/ask-pms";
import { InsightCards } from "@/features/ai/components/insight-cards";
import { revenueOutlook, listSegments, type Outlook } from "@/features/ai/queries";

export const metadata: Metadata = { title: "Ask PMS" };

/**
 * 18 T-12 — Ask-PMS: NL search + assistant + insight cards (AC-3/4/7/9).
 * `ai:use`-gated (staff only). The page itself hides when the caller lacks the
 * permission; the actions/routes re-check server-side regardless (security.md).
 */
export default async function AiPage() {
  const user = await requireUser();

  if (!hasPermission(user, "ai:use")) {
    return (
      <div className="mx-auto w-full max-w-2xl p-4">
        <Card>
          <CardHeader>
            <CardTitle>Ask PMS</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            You don&apos;t have access to the AI assistant.
          </CardContent>
        </Card>
      </div>
    );
  }

  const propertyId = user.activePropertyId ?? user.accessiblePropertyIds[0] ?? null;
  const canMoney = hasPermission(user, "report:view-financial");
  const outlook: Outlook | null = propertyId && canMoney ? await revenueOutlook(user, propertyId) : null;
  const segments = await listSegments(user);

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 p-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Ask PMS</h1>
        <p className="text-sm text-muted-foreground">
          Search in plain language or ask the assistant. Results are scoped to you and masked.
        </p>
      </div>
      <AskPms />
      <InsightCards outlook={outlook} segments={segments} />
    </div>
  );
}
