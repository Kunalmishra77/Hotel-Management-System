"use client";

/**
 * 09 addendum — manager field-staff view (FR-19). Tracked staff show their
 * last-known location (Open in Google Maps + stale badge) and their private
 * tracker link to share with the driver; others can be switched on. Manager-only
 * (the page is staff:manage-gated). Location is never shown to other staff.
 */
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Copy, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { enableFieldTracking, disableFieldTracking } from "../field-actions";
import type { FieldStaffLocation } from "../field-queries";

type Other = { id: string; name: string; department: string };

const ago = (d: Date) => {
  const mins = Math.round((Date.now() - new Date(d).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  return `${Math.round(mins / 60)} h ago`;
};

export function FieldStaffScreen({ tracked, others }: { tracked: FieldStaffLocation[]; others: Other[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const run = (fn: () => Promise<{ ok: boolean; error?: { message: string } }>, okMsg: string) =>
    start(async () => {
      const res = await fn();
      if (res.ok) { toast.success(okMsg); router.refresh(); }
      else toast.error(res.error?.message ?? "Something went wrong.");
    });

  function copyLink(token: string | null) {
    if (!token) return;
    const url = `${window.location.origin}/track/${token}`;
    void navigator.clipboard?.writeText(url);
    toast.success("Tracker link copied — share it with the driver.");
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 p-4">
      <h1 className="text-xl font-semibold">Field staff</h1>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Tracked</CardTitle></CardHeader>
        <CardContent>
          {tracked.length === 0 ? (
            <EmptyState icon={<MapPin />} title="No tracked field staff" description="Enable tracking for a driver or field agent below." />
          ) : (
            <ul className="space-y-2" data-testid="tracked-list">
              {tracked.map((t) => (
                <li key={t.staffId} className="rounded-lg border p-3" data-testid={`tracked-${t.staffId}`}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{t.name} <span className="text-xs font-normal text-muted-foreground">· {t.department}</span></p>
                      <p className="text-xs text-muted-foreground">
                        {t.lastPing ? (
                          <>Last seen {ago(t.lastPing.capturedAt)}{t.stale ? " · " : ""}</>
                        ) : "No location yet"}
                        {t.stale ? <span className="font-medium text-warning">stale</span> : null}
                      </p>
                    </div>
                    {t.mapsUrl ? (
                      <Button asChild variant="outline" size="sm">
                        <a href={t.mapsUrl} target="_blank" rel="noopener noreferrer" data-testid={`maps-${t.staffId}`}><MapPin className="size-4" /> Map</a>
                      </Button>
                    ) : null}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Button variant="ghost" size="sm" onClick={() => copyLink(t.trackingToken)} data-testid={`copy-${t.staffId}`}><Copy className="size-4" /> Copy tracker link</Button>
                    <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(() => disableFieldTracking({ staffId: t.staffId }), "Tracking disabled.")} data-testid={`disable-${t.staffId}`}>Disable</Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Enable tracking</CardTitle></CardHeader>
        <CardContent>
          {others.length === 0 ? (
            <p className="text-sm text-muted-foreground">All active staff are tracked.</p>
          ) : (
            <ul className="divide-y rounded-md border" data-testid="others-list">
              {others.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-2 p-3 text-sm">
                  <span className="min-w-0 truncate">{s.name} <span className="text-xs text-muted-foreground">· {s.department}</span></span>
                  <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => enableFieldTracking({ staffId: s.id }), "Tracking enabled — copy the link to the driver.")} data-testid={`enable-${s.id}`}>Enable</Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
