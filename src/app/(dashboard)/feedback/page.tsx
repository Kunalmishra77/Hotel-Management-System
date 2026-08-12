import type { Metadata } from "next";
import Link from "next/link";
import { Star, MessageSquare, Smile, Meh, Frown } from "lucide-react";
import { requirePermission } from "@/lib/auth/guard";
import { feedbackOverview, listFeedback } from "@/features/feedback/queries";
import { KpiCard } from "@/components/ui/kpi-card";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Feedback" };

const FILTERS: { key: string; label: string }[] = [
  { key: "", label: "All" },
  { key: "POSITIVE", label: "Positive" },
  { key: "NEUTRAL", label: "Neutral" },
  { key: "NEGATIVE", label: "Negative" },
];
const SENTIMENT: Record<string, { label: string; variant: "success" | "secondary" | "destructive" }> = {
  POSITIVE: { label: "Positive", variant: "success" },
  NEUTRAL: { label: "Neutral", variant: "secondary" },
  NEGATIVE: { label: "Negative", variant: "destructive" },
};
const isSentiment = (v: string) => v === "POSITIVE" || v === "NEUTRAL" || v === "NEGATIVE";
const fmtDate = (d: Date) => new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

/**
 * 18/05 — guest feedback & reviews for the active property: sentiment mix (AI-
 * labelled) + average rating, filterable by sentiment, each review linking to the
 * guest. `guest:view`; property-scoped. Sentiment is surfaced, never auto-acted on.
 */
export default async function FeedbackPage({
  searchParams,
}: {
  searchParams: Promise<{ sentiment?: string }>;
}) {
  const user = await requirePermission("guest:view");
  const propertyId = user.activePropertyId;
  if (!propertyId) {
    return <div className="p-4"><p className="text-sm text-muted-foreground">Select a property to see guest feedback.</p></div>;
  }

  const sp = await searchParams;
  const sentiment = sp.sentiment && isSentiment(sp.sentiment) ? sp.sentiment : undefined;

  const [overview, { feedback }] = await Promise.all([
    feedbackOverview(user, propertyId),
    listFeedback(user, { propertyId, sentiment, limit: 50 }),
  ]);

  return (
    <div className="mx-auto w-full max-w-4xl">
      <PageHeader title="Feedback" description="Guest reviews with AI sentiment — surfaced for action, never auto-acted on." />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5" data-testid="feedback-kpis">
        <KpiCard label="Reviews" value={overview.total} icon={<MessageSquare />} />
        <KpiCard label="Positive" value={overview.positive} icon={<Smile />} trend={overview.positive > 0 ? "up" : undefined} />
        <KpiCard label="Neutral" value={overview.neutral} icon={<Meh />} />
        <KpiCard label="Negative" value={overview.negative} icon={<Frown />} trend={overview.negative > 0 ? "down" : undefined} delta={overview.negative > 0 ? "Needs attention" : undefined} />
        <KpiCard label="Avg rating" value={overview.avgRating != null ? `${overview.avgRating.toFixed(1)}★` : "—"} icon={<Star />} hint="Out of 5" />
      </div>

      {/* Sentiment filter chips */}
      <div className="mt-4 flex flex-wrap gap-2" data-testid="sentiment-chips">
        {FILTERS.map((f) => {
          const active = (sentiment ?? "") === f.key;
          return (
            <Link
              key={f.key || "all"}
              href={f.key ? `/feedback?sentiment=${f.key}` : "/feedback"}
              className={cn(
                "rounded-full border px-3 py-1 text-sm font-medium transition-colors",
                active ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent",
              )}
            >
              {f.label}
            </Link>
          );
        })}
      </div>

      <div className="mt-3">
        {feedback.length === 0 ? (
          <p className="rounded-md border bg-muted/40 p-6 text-center text-sm text-muted-foreground">
            {sentiment ? "No feedback in this sentiment." : "No guest feedback yet."}
          </p>
        ) : (
          <ul className="space-y-2" data-testid="feedback-list">
            {feedback.map((f) => {
              const s = f.sentiment ? SENTIMENT[f.sentiment] : null;
              return (
                <li key={f.id} className="rounded-lg border bg-card p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link href={`/guests/${f.guestId}`} className="font-medium hover:underline">{f.guestName}</Link>
                      <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                        {f.rating != null ? <span className="text-warning">{"★".repeat(f.rating)}<span className="text-muted-foreground/40">{"★".repeat(Math.max(0, 5 - f.rating))}</span></span> : null}
                        {f.source ? <span>· {f.source}</span> : null}
                        <span>· {fmtDate(f.createdAt)}</span>
                      </div>
                    </div>
                    {s ? <Badge variant={s.variant}>{s.label}</Badge> : <Badge variant="outline">Unlabelled</Badge>}
                  </div>
                  {f.comment ? <p className="mt-2 text-sm">{f.comment}</p> : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
