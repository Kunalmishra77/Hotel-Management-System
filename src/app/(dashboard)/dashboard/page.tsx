import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { visibleNavItems } from "@/features/platform/navigation";
import { liveTiles } from "@/features/analytics/queries";
import { DashboardTiles } from "@/features/analytics/components/dashboard-tiles";

export const metadata: Metadata = { title: "Dashboard" };

/**
 * Placeholder home — 14-dashboard-analytics owns the real one (Tier 3).
 * 00 provides only the shell, so this shows what the signed-in user's
 * permissions actually unlock rather than inventing metrics no module computes
 * yet.
 */
export default async function DashboardPage() {
  const claims = await requireUser();
  const sections = visibleNavItems(claims.resolvedPermissions);

  // 14 live tiles for the active property (operational always; financial gated).
  const propertyId = claims.activePropertyId ?? claims.accessiblePropertyIds[0] ?? null;
  const canOperational = hasPermission(claims, "report:view-operational");
  const tiles = canOperational && propertyId ? await liveTiles(claims, [propertyId]) : null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Welcome, {claims.name}</h1>
        <p className="text-sm text-muted-foreground">
          {claims.roleAssignments.map((r) => r.role).join(", ")} ·{" "}
          {claims.accessiblePropertyIds.length} propert
          {claims.accessiblePropertyIds.length === 1 ? "y" : "ies"} in scope
        </p>
      </div>

      {tiles && (
        <DashboardTiles tiles={tiles} propertyId={propertyId} canRunAudit={hasPermission(claims, "report:view-financial")} />
      )}

      <Card>
        <CardHeader>
          <CardTitle>Your access</CardTitle>
          <CardDescription>
            Sections are filtered to your permissions. Operational dashboards arrive with module
            14.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-2 sm:grid-cols-2">
            {sections.map((s) => (
              <li
                key={s.key}
                className="rounded-md border px-3 py-2 text-sm"
                data-testid={`access-${s.key}`}
              >
                {s.label}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
