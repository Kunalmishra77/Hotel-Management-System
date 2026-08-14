import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, LogIn, LogOut, ClipboardCheck, TriangleAlert, Siren } from "lucide-react";
import { requirePermission } from "@/lib/auth/guard";
import { arrivalsDepartures, bookingsOverview, type ReservationListItem } from "@/features/reservations/queries";
import { listPendingApprovals } from "@/features/expenses/queries";
import { hasPermission } from "@/lib/permissions";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatINR } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Operations centre" };

/**
 * Manager · Operations Centre (architecture v2 · Phase 4). The daily attention
 * board for one property — everything that needs the manager's eye right now:
 * today's arrivals & departures, flagged (needs-attention) bookings, and pending
 * approvals. Read + route into the relevant record; the work itself happens there.
 */
export default async function OperationsPage() {
  const user = await requirePermission("report:view-operational");
  const propertyId = user.activePropertyId ?? user.accessiblePropertyIds[0] ?? null;
  const today = new Date();

  const [ad, overview, approvals] = await Promise.all([
    propertyId ? arrivalsDepartures(user, { propertyId, date: today }) : Promise.resolve({ arrivals: [], departures: [] }),
    propertyId ? bookingsOverview(user, { propertyId, date: today }) : Promise.resolve(null),
    hasPermission(user, "expense:approve") ? listPendingApprovals(user) : Promise.resolve([]),
  ]);
  const approvalsHere = propertyId ? approvals.filter((a) => a.propertyId === propertyId) : [];

  return (
    <div className="mx-auto w-full max-w-4xl px-1 py-1">
      <PageHeader
        title={<span className="inline-flex items-center gap-2"><Siren className="size-5 text-primary" aria-hidden="true" /> Operations centre</span>}
        description="Everything that needs your attention today."
      />

      <div className="mt-2 grid gap-4 lg:grid-cols-2">
        <ResSection
          title="Arriving today"
          icon={<LogIn className="size-4" aria-hidden="true" />}
          rows={ad.arrivals}
          emptyLabel="No arrivals due today."
          badge={(r) => (r.roomNumbers.length ? r.roomNumbers.join(", ") : "unassigned")}
        />
        <ResSection
          title="Departing today"
          icon={<LogOut className="size-4" aria-hidden="true" />}
          rows={ad.departures}
          emptyLabel="No departures due today."
          badge={(r) => (r.roomNumbers.length ? r.roomNumbers.join(", ") : "—")}
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <TriangleAlert className="size-4 text-amber-600" aria-hidden="true" /> Needs attention
            </CardTitle>
          </CardHeader>
          <CardContent>
            {overview && overview.needsAttention > 0 ? (
              <Link href="/bookings" className="inline-flex items-center gap-1.5 text-sm font-medium text-amber-700 underline-offset-4 hover:underline dark:text-amber-400">
                {overview.needsAttention} flagged booking{overview.needsAttention === 1 ? "" : "s"} to resolve
                <ArrowRight className="size-3.5" aria-hidden="true" />
              </Link>
            ) : (
              <p className="text-sm text-muted-foreground">No flagged bookings. All clear.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <ClipboardCheck className="size-4 text-primary" aria-hidden="true" /> Pending approvals
            </CardTitle>
          </CardHeader>
          <CardContent>
            {approvalsHere.length > 0 ? (
              <Link href="/approvals" className="inline-flex items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline">
                {approvalsHere.length} expense{approvalsHere.length === 1 ? "" : "s"} · {formatINR(approvalsHere.reduce((s, a) => s + a.amountPaise, 0))}
                <ArrowRight className="size-3.5" aria-hidden="true" />
              </Link>
            ) : (
              <p className="text-sm text-muted-foreground">Nothing awaiting approval.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function ResSection({
  title, icon, rows, emptyLabel, badge,
}: {
  title: string;
  icon: React.ReactNode;
  rows: ReservationListItem[];
  emptyLabel: string;
  badge: (r: ReservationListItem) => string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">{icon} {title} <span className="text-sm font-normal text-muted-foreground">· {rows.length}</span></CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{emptyLabel}</p>
        ) : (
          <ul className="space-y-1.5">
            {rows.map((r) => (
              <li key={r.id}>
                <Link href={`/bookings/${r.id}`} className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent">
                  <span className="min-w-0 truncate font-medium">{r.guestName}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{badge(r)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
