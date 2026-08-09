"use client";

/**
 * 27 owner-portal — schedule view (FR-9/10). Important renewal dates (with an
 * overdue flag), upcoming preventive maintenance, and a 30-day occupancy strip
 * (counts-only %, no guest PII). Staff with owner:manage get add/delete controls
 * for the important dates; the owner sees them read-only.
 */
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { AlertTriangle, CalendarClock, Plus, Trash2, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { createImportantDate, deleteImportantDate } from "../schedule-actions";
import { IMPORTANT_DATE_KINDS } from "../schema";
import type { OwnerScheduleView } from "../queries";

const fmt = (d: Date | string) =>
  new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

export function ScheduleView({
  propertyId,
  schedule,
  canManage,
}: {
  propertyId: string;
  schedule: OwnerScheduleView;
  canManage: boolean;
}) {
  const [kind, setKind] = useState<string>("LICENCE");
  const [label, setLabel] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [pending, start] = useTransition();

  const avgOcc =
    schedule.occupancy.length > 0
      ? Math.round(schedule.occupancy.reduce((s, o) => s + o.occupancyBps, 0) / schedule.occupancy.length / 100)
      : 0;

  function addDate() {
    if (!label.trim() || !dueDate) return toast.error("Enter a label and due date.");
    start(async () => {
      const res = await createImportantDate({ propertyId, kind, label: label.trim(), dueDate });
      if (res.ok) {
        toast.success("Date added.");
        setLabel("");
        setDueDate("");
        location.reload();
      } else toast.error(res.error.message);
    });
  }

  function removeDate(id: string) {
    start(async () => {
      const res = await deleteImportantDate({ dateId: id });
      if (res.ok) {
        toast.success("Date removed.");
        location.reload();
      } else toast.error(res.error.message);
    });
  }

  return (
    <div className="space-y-4">
      {/* Important dates */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Renewals & important dates</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {schedule.importantDates.length === 0 ? (
            <EmptyState icon={<CalendarClock />} title="Nothing scheduled" description="Licence, GST, AMC and insurance dates appear here." />
          ) : (
            <ul className="space-y-2" data-testid="important-dates">
              {schedule.importantDates.map((it) => (
                <li key={it.id} className="flex items-center justify-between gap-3 rounded-md border p-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      {it.label} <span className="text-xs font-normal text-muted-foreground">· {it.kind}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">Due {fmt(it.dueDate)}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {it.overdue ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-destructive/12 px-2 py-0.5 text-xs font-medium text-destructive">
                        <AlertTriangle className="size-3" /> Overdue
                      </span>
                    ) : null}
                    {canManage ? (
                      <Button variant="ghost" size="sm" onClick={() => removeDate(it.id)} disabled={pending} aria-label="Delete date">
                        <Trash2 className="size-4 text-destructive" />
                      </Button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}

          {canManage ? (
            <div className="flex flex-wrap items-end gap-2 border-t pt-3" data-testid="add-date">
              <div className="space-y-1">
                <label htmlFor="date-kind" className="text-xs text-muted-foreground">Kind</label>
                <Select value={kind} onValueChange={setKind}>
                  <SelectTrigger id="date-kind" className="w-32"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {IMPORTANT_DATE_KINDS.map((k) => <SelectItem key={k} value={k}>{k}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="min-w-0 flex-1 space-y-1">
                <label htmlFor="date-label" className="text-xs text-muted-foreground">Label</label>
                <Input id="date-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Fire NOC renewal" maxLength={160} />
              </div>
              <div className="space-y-1">
                <label htmlFor="date-due" className="text-xs text-muted-foreground">Due</label>
                <Input id="date-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </div>
              <Button size="sm" onClick={addDate} disabled={pending}><Plus className="size-4" /> Add</Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* Maintenance */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Upcoming maintenance</CardTitle>
        </CardHeader>
        <CardContent>
          {schedule.maintenance.length === 0 ? (
            <EmptyState icon={<Wrench />} title="No maintenance scheduled" />
          ) : (
            <ul className="space-y-2" data-testid="owner-maintenance">
              {schedule.maintenance.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-3 rounded-md border p-3 text-sm">
                  <span className="min-w-0 truncate">
                    {m.roomNumber ? <span className="font-medium">Room {m.roomNumber} · </span> : null}
                    {m.description}
                  </span>
                  {m.scheduledFor ? <span className="shrink-0 text-xs text-muted-foreground">{fmt(m.scheduledFor)}</span> : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Occupancy strip */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Occupancy — last 30 days ({avgOcc}% avg)</CardTitle>
        </CardHeader>
        <CardContent>
          {schedule.occupancy.length === 0 ? (
            <p className="text-sm text-muted-foreground">No occupancy data for this range.</p>
          ) : (
            <div className="flex items-end gap-0.5" data-testid="occupancy-strip" style={{ height: 64 }}>
              {schedule.occupancy.map((o) => (
                <div
                  key={o.businessDate}
                  title={`${fmt(o.businessDate)}: ${Math.round(o.occupancyBps / 100)}%`}
                  className="flex-1 rounded-sm bg-primary/70"
                  style={{ height: `${Math.max(2, Math.min(100, o.occupancyBps / 100))}%` }}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
