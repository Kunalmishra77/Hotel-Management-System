import type { Metadata } from "next";
import Link from "next/link";
import { BedDouble, CalendarCheck, UserCheck, ArrowRight } from "lucide-react";
import { requirePermission } from "@/lib/auth/guard";
import { listReservations } from "@/features/reservations/queries";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { cn, formatDayMonth } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "In-house guests" };

const isToday = (d: Date): boolean => {
  const now = new Date();
  return new Date(d).toDateString() === now.toDateString();
};

/**
 * In-House Guests (architecture v2 · Reception/Manager). A dedicated view of every
 * currently-staying guest — room, stay window, checkout flag — the front desk's
 * primary working list after check-in. Each row opens the booking (folio, checkout,
 * charges). Property-scoped to the caller's active property.
 */
export default async function InHousePage() {
  const user = await requirePermission("reservation:view");
  const propertyId = user.activePropertyId ?? user.accessiblePropertyIds[0] ?? null;

  const rows = propertyId
    ? (await listReservations(user, { propertyId, status: "IN_HOUSE", limit: 100 })).reservations
    : [];

  return (
    <div className="mx-auto w-full max-w-3xl px-1 py-1">
      <PageHeader title="In-house guests" description={`${rows.length} guest${rows.length === 1 ? "" : "s"} currently staying.`} />

      {rows.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed bg-muted/30 p-10 text-center">
          <UserCheck className="mx-auto size-6 text-muted-foreground" aria-hidden="true" />
          <p className="mt-3 text-sm font-medium">No guests in-house</p>
          <p className="mt-1 text-sm text-muted-foreground">Checked-in guests appear here.</p>
        </div>
      ) : (
        <ul className="mt-6 space-y-2.5">
          {rows.map((r) => {
            const leavingToday = isToday(r.checkOutDate);
            return (
              <li key={r.id}>
                <Link href={`/bookings/${r.id}`}>
                  <Card className="u-lift flex items-center justify-between gap-3 p-4">
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{r.guestName}</p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <BedDouble className="size-3.5" aria-hidden="true" />
                          {r.roomNumbers.length ? r.roomNumbers.join(", ") : "Unallocated"}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <CalendarCheck className="size-3.5" aria-hidden="true" />
                          out {formatDayMonth(r.checkOutDate)}
                        </span>
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {leavingToday ? (
                        <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-400">
                          Leaving today
                        </span>
                      ) : null}
                      {r.needsAttention ? (
                        <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-medium text-destructive">
                          {r.needsAttention}
                        </span>
                      ) : null}
                      <ArrowRight className={cn("size-4 text-muted-foreground")} aria-hidden="true" />
                    </div>
                  </Card>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
