import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PmsAgent } from "@/features/ai/components/pms-agent";
import { InsightCards } from "@/features/ai/components/insight-cards";
import { revenueOutlook, listSegments, type Outlook } from "@/features/ai/queries";
import { AGENT_SUGGESTIONS } from "@/features/ai/domain/agent-intents";

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
    <div className="mx-auto w-full max-w-4xl space-y-4 p-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">AI Assistant</h1>
        <p className="text-sm text-muted-foreground">
          Ask in English or Hindi — bookings, guests, rooms, dues, revenue, or how to do something. Answers come from your live data; nothing leaves the platform.
        </p>
      </div>
      {/* One assistant, no external AI: live answers + how-to (client, 12 Nov 2026). */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Ask anything about your hotels</CardTitle></CardHeader>
        <CardContent><PmsAgent suggestions={AGENT_SUGGESTIONS} /></CardContent>
      </Card>
      <InsightCards outlook={outlook} segments={segments} />
    </div>
  );
}
