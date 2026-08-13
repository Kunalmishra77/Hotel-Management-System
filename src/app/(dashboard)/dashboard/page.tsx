import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowUpRight, Building2, Cable, CalendarCheck, CalendarDays, CalendarPlus, ChartColumn, Gauge, LogOut, ReceiptText, Search, ShieldCheck, Sparkles, UserPlus, Users, Wallet, Wrench } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { hasPermission, type Permission } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { visibleNavItems } from "@/features/platform/navigation";
import { NavIcon } from "@/features/platform/components/nav-icon";
import { liveTiles, trend } from "@/features/analytics/queries";
import { DashboardTiles } from "@/features/analytics/components/dashboard-tiles";
import { TrendChart } from "@/components/ui/charts/trend-chart";
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
  const canFinancial = hasPermission(claims, "report:view-financial");

  const today = new Date();
  const trendFrom = new Date(today.getTime() - 13 * 86_400_000);
  const [tiles, ad, revTrend] = await Promise.all([
    canOperational && propertyId ? liveTiles(claims, [propertyId]) : Promise.resolve(null),
    canReservations && propertyId
      ? arrivalsDepartures(claims, { propertyId, date: today })
      : Promise.resolve(null),
    canFinancial && propertyId
      ? trend(claims, { metric: "revenue", from: trendFrom, to: today, propertyIds: [propertyId] })
      : Promise.resolve(null),
  ]);

  const props = claims.accessiblePropertyIds.length;
  const roleText = claims.roleAssignments.map((r) => ROLE_LABELS[r.role]).join(", ");

  // Role-appropriate quick actions — show what this ROLE actually does day-to-day,
  // not everything its permissions allow. An Administrator holds every permission,
  // but "New booking" isn't an admin's job (it's Reception's); showing it there is
  // confusing. So the set is chosen by the caller's most-senior role, then still
  // filtered by permission for safety (no dead links).
  type QA = { key: string; label: string; href: string; icon: ReactNode; permission: Permission; primary?: boolean };
  const ACTIONS_BY_ROLE: { role: string; actions: QA[] }[] = [
    { role: "ADMINISTRATOR", actions: [
      { key: "command", label: "Command centre", href: "/overview", icon: <Gauge />, permission: "report:view-financial", primary: true },
      { key: "users", label: "Users & access", href: "/settings/users", icon: <ShieldCheck />, permission: "user:manage" },
      { key: "properties", label: "Properties", href: "/properties", icon: <Building2 />, permission: "room:view-status" },
      { key: "integrations", label: "Integrations", href: "/settings/integrations", icon: <Cable />, permission: "integration:manage" },
    ] },
    { role: "MANAGER", actions: [
      { key: "overview", label: "Overview", href: "/overview", icon: <Gauge />, permission: "report:view-financial", primary: true },
      { key: "bookings", label: "Bookings", href: "/bookings", icon: <CalendarDays />, permission: "reservation:view" },
      { key: "guests", label: "Guests", href: "/guests", icon: <Users />, permission: "guest:view" },
      { key: "reports", label: "Reports", href: "/reports", icon: <ChartColumn />, permission: "report:view-financial" },
    ] },
    { role: "ACCOUNTS", actions: [
      { key: "billing", label: "Billing", href: "/billing", icon: <ReceiptText />, permission: "folio:view", primary: true },
      { key: "expenses", label: "Expenses", href: "/expenses", icon: <Wallet />, permission: "expense:create" },
      { key: "reports", label: "Reports", href: "/reports", icon: <ChartColumn />, permission: "report:view-financial" },
      { key: "overview", label: "Overview", href: "/overview", icon: <Gauge />, permission: "report:view-financial" },
    ] },
    { role: "RECEPTION", actions: [
      { key: "new-booking", label: "New booking", href: "/bookings/new", icon: <CalendarPlus />, permission: "reservation:create", primary: true },
      { key: "new-guest", label: "New guest", href: "/guests/new", icon: <UserPlus />, permission: "guest:create" },
      { key: "find-guest", label: "Find guest", href: "/search", icon: <Search />, permission: "guest:view" },
      { key: "billing", label: "Billing", href: "/billing", icon: <ReceiptText />, permission: "folio:view" },
    ] },
    { role: "HOUSEKEEPING", actions: [
      { key: "housekeeping", label: "Housekeeping", href: "/housekeeping", icon: <Sparkles />, permission: "housekeeping:update", primary: true },
    ] },
    { role: "MAINTENANCE", actions: [
      { key: "maintenance", label: "Maintenance", href: "/maintenance", icon: <Wrench />, permission: "maintenance:manage", primary: true },
    ] },
  ];
  const roles = claims.roleAssignments.map((r) => r.role as string);
  const roleSet = ACTIONS_BY_ROLE.find((s) => roles.includes(s.role))?.actions ?? [];
  const actions = roleSet.filter((a) => hasPermission(claims, a.permission));

  return (
    <div className="space-y-6">
      <PageHeader title={`Welcome, ${claims.name}`} description={`${roleText} · ${props} propert${props === 1 ? "y" : "ies"} in scope`} />

      {actions.length > 0 ? (
        <div className="flex flex-wrap gap-2" data-testid="quick-actions">
          {actions.map((a) => (
            <Button key={a.key} asChild size="lg" variant={a.primary ? "default" : "outline"}>
              <Link href={a.href} data-testid={`quick-${a.key}`}>
                {a.icon}
                <span className="ml-1.5">{a.label}</span>
              </Link>
            </Button>
          ))}
        </div>
      ) : null}

      {tiles ? (
        <DashboardTiles tiles={tiles} propertyId={propertyId} canRunAudit={hasPermission(claims, "report:view-financial")} />
      ) : null}

      {revTrend && revTrend.length > 0 ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Revenue — last 14 days</CardTitle>
          </CardHeader>
          <CardContent>
            <TrendChart data={revTrend.map((p) => ({ label: p.businessDate, value: p.value }))} format="inr" height={160} />
          </CardContent>
        </Card>
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
