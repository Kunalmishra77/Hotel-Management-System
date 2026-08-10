import type { Metadata } from "next";
import { hasPermission } from "@/lib/permissions";
import { requirePermission } from "@/lib/auth/guard";
import { listAutomations, listCampaigns, listMessageLog, listTemplates } from "@/features/communications/queries";
import { listSegments } from "@/features/ai/queries";
import { CommunicationsScreen } from "@/features/communications/components/communications-screen";

export const metadata: Metadata = { title: "Communications" };

/** 12 T-22/T-23 — templates, automations, campaigns and the message log. */
export default async function CommunicationsPage() {
  // Everyone who can send may view; management actions re-check server-side.
  const user = await requirePermission("communication:send");
  const propertyId = user.activePropertyId;

  const canManage = hasPermission(user, "communication:template-manage");
  const [templates, automations, campaigns, log, segments] = await Promise.all([
    listTemplates(user),
    listAutomations(user),
    listCampaigns(user),
    propertyId ? listMessageLog(user, { propertyId, limit: 50 }) : Promise.resolve([]),
    // Segments target campaigns; only fetch for managers who can launch them.
    canManage ? listSegments(user) : Promise.resolve([]),
  ]);

  const templateKeys = [...new Set(templates.map((t) => t.key))];

  return (
    <CommunicationsScreen
      templates={templates}
      automations={automations}
      campaigns={campaigns}
      log={log}
      templateKeys={templateKeys}
      segments={segments}
      canManage={canManage}
      propertyId={propertyId}
    />
  );
}
