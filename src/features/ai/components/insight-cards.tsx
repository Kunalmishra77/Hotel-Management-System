/**
 * 18 T-12 — insight cards (AC-7/9). Server-rendered summaries: the revenue
 * outlook (trend from grounded snapshots) and the advisory guest segments.
 * "Suggest rates" routes to the 24 approval flow — 18 only suggests.
 */
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { Outlook, SegmentCard } from "../queries";

export function InsightCards({ outlook, segments }: { outlook: Outlook | null; segments: SegmentCard[] }) {
  const arrow = outlook?.trend === "up" ? "↑" : outlook?.trend === "down" ? "↓" : "→";
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Card data-testid="insight-forecast">
        <CardHeader>
          <CardTitle className="text-base">Revenue outlook</CardTitle>
          <CardDescription>Grounded in your daily snapshots</CardDescription>
        </CardHeader>
        <CardContent className="text-sm">
          {outlook && outlook.points > 0 ? (
            <p>
              {arrow} projected {outlook.changePct >= 0 ? "+" : ""}
              {outlook.changePct}% over the next 14 days.
            </p>
          ) : (
            <p className="text-muted-foreground">Not enough history yet.</p>
          )}
        </CardContent>
      </Card>

      <Card data-testid="insight-segments">
        <CardHeader>
          <CardTitle className="text-base">Guest segments</CardTitle>
          <CardDescription>Advisory groupings for marketing (12)</CardDescription>
        </CardHeader>
        <CardContent className="text-sm">
          {segments.length > 0 ? (
            <ul className="space-y-1">
              {segments.slice(0, 5).map((s) => (
                <li key={s.id} className="flex justify-between">
                  <span>{s.name}</span>
                  <span className="text-muted-foreground">{s.size}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground">No segments computed yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
