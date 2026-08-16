import type { Metadata } from "next";
import Link from "next/link";
import { Star, Smile, Frown, Meh, ConciergeBell, MessageSquare, ArrowRight } from "lucide-react";
import { requirePermission } from "@/lib/auth/guard";
import { hasPermission } from "@/lib/permissions";
import { feedbackOverview } from "@/features/feedback/queries";
import { listGuestRequests } from "@/features/guest-requests/queries";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { KpiCard } from "@/components/ui/kpi-card";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Guest experience" };

/**
 * Manager · Guest Experience (architecture v2 · consolidation). One place for
 * guest satisfaction: rating + sentiment, open service requests, and shortcuts
 * into feedback, requests, and chat. `guest:view`.
 */
export default async function GuestExperiencePage() {
  const user = await requirePermission("guest:view");
  const propertyId = user.activePropertyId ?? user.accessiblePropertyIds[0] ?? null;

  const [fb, requests] = await Promise.all([
    propertyId ? feedbackOverview(user, propertyId) : Promise.resolve(null),
    hasPermission(user, "request:manage") ? listGuestRequests() : Promise.resolve([]),
  ]);

  const links = [
    { href: "/feedback", label: "All feedback & reviews", icon: <Star className="size-4" /> },
    { href: "/requests", label: "Service requests", icon: <ConciergeBell className="size-4" /> },
    { href: "/messages", label: "Guest messages", icon: <MessageSquare className="size-4" /> },
  ];

  return (
    <div className="mx-auto w-full max-w-3xl px-1 py-1">
      <PageHeader title="Guest experience" description="Satisfaction, complaints, and service quality — in one view." />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <KpiCard label="Avg rating" value={fb?.avgRating != null ? `${fb.avgRating.toFixed(1)} / 5` : "—"} icon={<Star />} hint={`${fb?.total ?? 0} reviews`} />
        <KpiCard label="Open requests" value={String(requests.length)} icon={<ConciergeBell />} />
        <KpiCard label="Negative" value={String(fb?.negative ?? 0)} icon={<Frown />} hint="needs attention" />
      </div>

      {fb && fb.total > 0 && (
        <Card className="mt-4">
          <CardHeader className="pb-2"><CardTitle className="text-base">Sentiment</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="rounded-lg bg-emerald-600/10 p-3">
                <Smile className="mx-auto size-5 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
                <p className="mt-1 text-lg font-semibold">{fb.positive}</p>
                <p className="text-xs text-muted-foreground">Positive</p>
              </div>
              <div className="rounded-lg bg-muted p-3">
                <Meh className="mx-auto size-5 text-muted-foreground" aria-hidden="true" />
                <p className="mt-1 text-lg font-semibold">{fb.neutral}</p>
                <p className="text-xs text-muted-foreground">Neutral</p>
              </div>
              <div className="rounded-lg bg-destructive/10 p-3">
                <Frown className="mx-auto size-5 text-destructive" aria-hidden="true" />
                <p className="mt-1 text-lg font-semibold">{fb.negative}</p>
                <p className="text-xs text-muted-foreground">Negative</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="mt-4 grid gap-2.5 sm:grid-cols-3">
        {links.map((l) => (
          <Link key={l.href} href={l.href} className="group flex items-center justify-between rounded-xl border bg-card p-4 shadow-sm transition hover:border-primary/40 hover:shadow-md">
            <span className="inline-flex items-center gap-2 text-sm font-medium">{l.icon} {l.label}</span>
            <ArrowRight className="size-4 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-primary" aria-hidden="true" />
          </Link>
        ))}
      </div>
    </div>
  );
}
