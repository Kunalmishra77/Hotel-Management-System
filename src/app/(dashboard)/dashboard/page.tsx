import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, CalendarCheck, LogOut } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { visibleNavItems } from "@/features/platform/navigation";
import { NavIcon } from "@/features/platform/components/nav-icon";
import { liveTiles } from "@/features/analytics/queries";
import { DashboardTiles } from "@/features/analytics/components/dashboard-tiles";
import { arrivalsDepartures } from "@/features/reservations/queries";
import { ArrivalsDeparturesCard } from "@/features/reservations/components/arrivals-departures-card";
import { ROLE_LABELS } from "@/features/users/roles";

export const metadata: Metadata = { title: "Dashboard" };

/**
 * The signed-in home: 14's live operational tiles + today's arrivals/departures
 * (both permission-gated) plus a quick-access grid filtered to the caller.
 */
export default async function DashboardPage() {
  const claims = await requireUser();
  const sections = visibleNavItems(claims.resolvedPermissions).filter((s) => s.key !== "dashboard");

  const propertyId = claims.activePropertyId ?? claims.accessiblePropertyIds[0] ?? null;
  const canOperational = hasPermission(claims, "report:view-operational");
  const canReservations = hasPermission(claims, "reservation:view");

  const [tiles, ad] = await Promise.all([
    canOperational && propertyId ? liveTiles(claims, [propertyId]) : Promise.resolve(null),
    canReservations && propertyId
      ? arrivalsDepartures(claims, { propertyId, date: new Date() })
      : Promise.resolve(null),
  ]);

  const props = claims.accessiblePropertyIds.length;
  const roleText = claims.roleAssignments.map((r) => ROLE_LABELS[r.role]).join(", ");

  return (
    <div className="space-y-6">
      <PageHeader title={`Welcome, ${claims.name}`} description={`${roleText} · ${props} propert${props === 1 ? "y" : "ies"} in scope`} />

      {tiles ? (
        <DashboardTiles tiles={tiles} propertyId={propertyId} canRunAudit={hasPermission(claims, "report:view-financial")} />
      ) : null}

      {ad ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <ArrivalsDeparturesCard title="Arrivals today" icon={<CalendarCheck />} emptyLabel="No arrivals today." items={ad.arrivals} />
          <ArrivalsDeparturesCard title="Departures today" icon={<LogOut />} emptyLabel="No departures today." items={ad.departures} />
        </div>
      ) : null}

      {!tiles && !ad ? (
        <Card>
          <CardContent className="p-5 text-sm text-muted-foreground">
            Use quick access below to jump to your work.
          </CardContent>
        </Card>
      ) : null}

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
                  className="group flex items-center gap-3 rounded-lg border bg-card px-3 py-2.5 text-sm font-medium shadow-card transition-colors hover:border-primary/40 hover:bg-primary/5"
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
