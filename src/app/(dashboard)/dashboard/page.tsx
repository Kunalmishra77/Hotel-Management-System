import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { visibleNavItems } from "@/features/platform/navigation";
import { NavIcon } from "@/features/platform/components/nav-icon";
import { liveTiles } from "@/features/analytics/queries";
import { DashboardTiles } from "@/features/analytics/components/dashboard-tiles";

export const metadata: Metadata = { title: "Dashboard" };

/**
 * The signed-in home: 14's live operational tiles (permission-gated) plus a
 * quick-access grid of the areas this user can reach.
 */
export default async function DashboardPage() {
  const claims = await requireUser();
  const sections = visibleNavItems(claims.resolvedPermissions).filter((s) => s.key !== "dashboard");

  const propertyId = claims.activePropertyId ?? claims.accessiblePropertyIds[0] ?? null;
  const canOperational = hasPermission(claims, "report:view-operational");
  const tiles = canOperational && propertyId ? await liveTiles(claims, [propertyId]) : null;

  const props = claims.accessiblePropertyIds.length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Welcome, {claims.name}</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {claims.roleAssignments.map((r) => r.role).join(", ")} · {props} propert{props === 1 ? "y" : "ies"} in scope
        </p>
      </div>

      {tiles ? (
        <DashboardTiles tiles={tiles} propertyId={propertyId} canRunAudit={hasPermission(claims, "report:view-financial")} />
      ) : (
        <Card>
          <CardContent className="p-5 text-sm text-muted-foreground">
            Operational tiles appear for roles with dashboard access. Use quick access below to jump to your work.
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Quick access</CardTitle>
          <CardDescription>Everywhere you can go — filtered to your permissions.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {sections.map((s) => (
              <li key={s.key}>
                <Link
                  href={s.href}
                  data-testid={`access-${s.key}`}
                  className="group flex items-center gap-3 rounded-lg border bg-card px-3 py-2.5 text-sm font-medium shadow-sm transition-colors hover:border-primary/40 hover:bg-primary/5"
                >
                  <span className="flex size-8 items-center justify-center rounded-md bg-muted text-muted-foreground transition-colors group-hover:bg-primary/10 group-hover:text-primary">
                    <NavIcon name={s.icon} className="size-4" />
                  </span>
                  <span className="flex-1">{s.label}</span>
                  <ArrowUpRight className="size-4 text-muted-foreground/50 transition-colors group-hover:text-primary" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
