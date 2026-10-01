import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { CalendarCheck, BedDouble, IndianRupee, Wallet, Clock, UserPen } from "lucide-react";
import { hasPermission } from "@/lib/permissions";
import { requirePermission } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { getGuestProfile } from "@/features/guests/queries";
import { GuestProfile } from "@/features/guests/components/guest-profile";
import { getGuestHistory, guestStays } from "@/features/guest-history/queries";
import { guestTier } from "@/features/guest-history/domain/tier";
import { GuestHistorySection } from "@/features/guest-history/components/guest-history-section";
import { GuestStaysCard } from "@/features/guest-history/components/guest-stays-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatINR } from "@/lib/utils";

export const metadata: Metadata = { title: "Guest" };

const TIER_VARIANT: Record<string, "brass" | "secondary" | "outline"> = { VIP: "brass", REPEAT: "secondary", NEW: "outline" };
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("") || "G";

/** 04 T-19 profile + 05 T-9 history — premium, comprehensive, two-column layout. */
export default async function GuestProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("guest:view");
  const { id } = await params;
  const guest = await getGuestProfile(user, id);
  if (!guest) notFound();

  // Editable only while a stay is ACTIVE (enquiry/confirmed/in-house); view-only after.
  const activeStay = await db.scoped(user).reservation.findFirst({
    where: { guestId: id, status: { in: ["ENQUIRY", "CONFIRMED", "IN_HOUSE"] } },
    select: { id: true },
  });
  const canManage = hasPermission(user, "guest:manage") && activeStay !== null;

  const [history, stays] = await Promise.all([getGuestHistory(user, id), guestStays(user, id)]);
  const preferredCategory = history.preferredCategoryId
    ? await db.scoped(user).roomCategory.findFirst({ where: { id: history.preferredCategoryId }, select: { name: true } })
    : null;
  const tier = guestTier({ visits: history.visits, revenuePaise: history.totalRevenuePaise ?? 0 });

  const stats: { label: string; value: string; icon: React.ReactNode; tone?: string }[] = [
    { label: "Visits", value: String(history.visits), icon: <CalendarCheck /> },
    { label: "Room-nights", value: String(history.totalRoomNights), icon: <BedDouble /> },
    { label: "Lifetime spend", value: formatINR(history.totalRevenuePaise ?? 0), icon: <IndianRupee /> },
    { label: "Outstanding", value: formatINR(history.outstandingPaise ?? 0), icon: <Wallet />, tone: (history.outstandingPaise ?? 0) > 0 ? "text-amber-700 dark:text-amber-400" : "text-success" },
    { label: "Last stay", value: history.lastStayAt ? history.lastStayAt.toISOString().slice(0, 10) : "—", icon: <Clock /> },
  ];

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-6 p-4">
      {/* Premium hero */}
      <Card className="overflow-hidden">
        <div className="flex flex-col gap-4 bg-gradient-to-br from-primary/10 to-transparent p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <div className="grid size-16 shrink-0 place-items-center rounded-2xl bg-primary/15 text-xl font-bold text-primary shadow-sm">
              {initials(guest.fullName)}
            </div>
            <div className="min-w-0">
              <h1 className="font-serif text-2xl font-semibold tracking-tight sm:text-[28px]" data-testid="guest-name">{guest.fullName}</h1>
              {guest.companyName ? <p className="text-sm text-muted-foreground">{guest.companyName}</p> : null}
              <div className="mt-1.5 flex flex-wrap gap-1.5" data-testid="guest-tags">
                <Badge variant={TIER_VARIANT[tier.tier] ?? "outline"}>{tier.label}</Badge>
                {guest.companyName ? <Badge variant="secondary">Corporate</Badge> : null}
                {guest.nationality ? <Badge variant="outline">{guest.nationality}</Badge> : null}
              </div>
            </div>
          </div>
          <div className="flex shrink-0 gap-2">
            {canManage ? (
              <Button asChild size="sm" data-testid="edit-guest"><Link href={`/guests/${guest.id}/edit`}><UserPen /> Edit</Link></Button>
            ) : null}
            <Button asChild variant="outline" size="sm"><Link href="/guests">Back</Link></Button>
          </div>
        </div>
        {/* Lifetime value strip */}
        <div className="grid grid-cols-2 divide-x divide-y border-t sm:grid-cols-3 lg:grid-cols-5 lg:divide-y-0">
          {stats.map((s) => (
            <div key={s.label} className="p-4">
              <p className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground [&_svg]:size-3.5">{s.icon}{s.label}</p>
              <p className={`mt-1 font-display text-lg font-semibold tabular ${s.tone ?? ""}`}>{s.value}</p>
            </div>
          ))}
        </div>
      </Card>

      {/* Two-column: identity/contact on the left, stays + history on the right */}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-1">
          <GuestProfile guest={guest} canRevealPii={hasPermission(user, "guest:view-pii")} canManage={canManage} />
        </div>
        <div className="space-y-6 lg:col-span-2">
          <GuestStaysCard stays={stays} />
          <GuestHistorySection history={history} preferredCategoryName={preferredCategory?.name ?? null} />
        </div>
      </div>
    </div>
  );
}
