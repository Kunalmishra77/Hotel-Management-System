"use client";

/**
 * Change a booking's source/channel at any time (even after check-in) — e.g. an
 * OTA (MakeMyTrip) guest who cancels the OTA booking on arrival and continues as a
 * direct booking. Updates revenue-by-source reporting on save.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { changeBookingSource } from "../move-actions";
import { changeExtensionSource } from "../extension-actions";
import { SOURCE_OPTIONS as SOURCES, sourceOptionLabel } from "../source-options";


type ExtensionSpan = { from: string; to: string; source: string };
const short = (ymd: string) => new Date(`${ymd}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
const nightsOf = (e: ExtensionSpan) => Math.round((Date.parse(e.to) - Date.parse(e.from)) / 86_400_000);

export function ChangeSourceCard({
  reservationId,
  currentSource,
  currentBookedOn,
  extensions = [],
}: {
  reservationId: string;
  currentSource: string;
  currentBookedOn: string;
  /** Extensions and the channel their added nights came through (client, 6 Nov 2026). */
  extensions?: ExtensionSpan[];
}) {
  const router = useRouter();
  const [source, setSource] = useState(currentSource);
  const [bookedOn, setBookedOn] = useState(currentBookedOn);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const dirty = source !== currentSource || bookedOn !== currentBookedOn;
  const save = () =>
    start(async () => {
      setError(null);
      const res = await changeBookingSource({ reservationId, source, bookedOn });
      if (res.ok) { setSaved(true); router.refresh(); setTimeout(() => setSaved(false), 2000); }
      else setError(res.error.message);
    });

  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base">Booking source</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        <p className="text-xs text-muted-foreground">Change the channel this booking is attributed to — e.g. an OTA guest who continues as a direct booking. The booked-on date can be corrected to match.</p>
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-48 flex-1 space-y-1.5">
            <Label htmlFor="src">Source</Label>
            <select id="src" value={source} onChange={(e) => setSource(e.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" data-testid="change-source-select">
              {SOURCES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
          <div className="min-w-40 space-y-1.5">
            <Label htmlFor="booked-on">Booked on</Label>
            <Input id="booked-on" type="date" value={bookedOn} onChange={(e) => setBookedOn(e.target.value)} data-testid="change-source-date" />
          </div>
          <Button disabled={pending || !dirty} onClick={save} data-testid="change-source-save">
            {pending ? "Saving…" : saved ? "Saved" : "Change source"}
          </Button>
        </div>
        {extensions.length > 0 ? (
          <div className="rounded-md border bg-muted/40 p-2 text-sm" data-testid="source-by-nights">
            <p className="font-medium">Source by nights</p>
            <ul className="mt-1 space-y-0.5 text-muted-foreground">
              <li>Original booking: <span className="text-foreground">{sourceOptionLabel(currentSource)}</span></li>
              {extensions.map((e) => (
                <ExtensionSourceRow key={e.from} reservationId={reservationId} ext={e} />
              ))}
            </ul>
            <p className="mt-1 text-xs text-muted-foreground">Each extension&apos;s nights count for its own channel and go on that channel&apos;s bill. &ldquo;Change source&rdquo; above changes the original booking only; fix an extension&apos;s channel on its own line.</p>
          </div>
        ) : null}
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      </CardContent>
    </Card>
  );
}

/** One extension line with its own channel picker (client, 17 Nov 2026). */
function ExtensionSourceRow({ reservationId, ext }: { reservationId: string; ext: ExtensionSpan }) {
  const router = useRouter();
  const [source, setSource] = useState(ext.source);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const save = () =>
    start(async () => {
      setError(null);
      const res = await changeExtensionSource({ reservationId, fromDate: ext.from, source });
      if (res.ok) router.refresh();
      else setError(res.error.message);
    });
  return (
    <li className="flex flex-wrap items-center gap-2 py-0.5" data-testid={`ext-source-${ext.from}`}>
      <span>Extension {short(ext.from)} → {short(ext.to)} ({nightsOf(ext)} night{nightsOf(ext) === 1 ? "" : "s"}):</span>
      <select value={source} onChange={(e) => setSource(e.target.value)} aria-label={`Channel for the extension from ${short(ext.from)}`}
        className="h-8 rounded-md border border-input bg-background px-2 text-sm text-foreground">
        {SOURCES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
      </select>
      {source !== ext.source ? (
        <Button size="sm" variant="outline" disabled={pending} onClick={save} className="h-8">{pending ? "Saving…" : "Save"}</Button>
      ) : null}
      {error ? <span role="alert" className="text-xs text-destructive">{error}</span> : null}
    </li>
  );
}
