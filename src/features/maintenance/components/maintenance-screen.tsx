"use client";

/**
 * Maintenance board — 11 T-10/T-11 (AC-1/4/6). Create a job, work it (start →
 * close-with-cost), block a room (refused if a guest is booked), and see the
 * preventive schedule. Mobile-first, ≥44px actions.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useRealtime } from "@/hooks/use-realtime";
import { StatStrip } from "@/components/ui/stat-strip";
import { createJob, startJob, closeJob, blockRoomForJob } from "../actions";
import type { MaintenanceJobItem, MaintenanceOverview } from "../queries";

const CATEGORIES = ["AC", "ELECTRICAL", "PLUMBING", "FURNITURE", "PAINTING", "PEST_CONTROL", "OTHER"];
const rupees = (p: number) => `₹${(p / 100).toLocaleString("en-IN")}`;
const toPaise = (r: number) => Math.round(r * 100);
const fmtDate = (d: Date | null) =>
  d ? d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

export function MaintenanceScreen({ propertyId, jobs, overview }: { propertyId: string; jobs: MaintenanceJobItem[]; overview: MaintenanceOverview }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState("AC");
  const [description, setDescription] = useState("");
  const [preventive, setPreventive] = useState(false);
  const [scheduledFor, setScheduledFor] = useState("");

  // Live board: a job raised (e.g. from a housekeeping complaint) or closed on
  // another device refreshes this list without a manual reload.
  useRealtime({ types: ["MaintenanceJobCreated", "MaintenanceJobClosed"], propertyId });

  const upcomingPreventive = jobs
    .filter((j) => j.isPreventive && j.status !== "CLOSED")
    .sort((a, b) => (a.scheduledFor?.getTime() ?? 0) - (b.scheduledFor?.getTime() ?? 0));

  const run = (fn: () => Promise<{ ok: boolean; error?: { message: string } }>, onOk?: () => void) => {
    setError(null);
    start(async () => {
      const res = await fn();
      if (res.ok) { onOk?.(); router.refresh(); }
      else setError(res.error?.message ?? "Something went wrong.");
    });
  };

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 p-4">
      <h1 className="text-xl font-semibold">Maintenance</h1>

      <StatStrip
        items={[
          { label: "Open", value: overview.open, tone: overview.open > 0 ? "warning" : "default" },
          { label: "In progress", value: overview.inProgress },
          { label: "Urgent / high", value: overview.urgent, tone: overview.urgent > 0 ? "danger" : "default" },
          { label: "Preventive due", value: overview.preventiveDue, tone: overview.preventiveDue > 0 ? "warning" : "default" },
          { label: "Rooms blocked", value: overview.roomsBlocked },
          { label: "Spend (month)", value: rupees(overview.costThisMonthPaise) },
        ]}
      />

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">New job</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="m-cat">Category</Label>
              <select id="m-cat" value={category} onChange={(e) => setCategory(e.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" data-testid="job-category">
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="space-y-1.5"><Label htmlFor="m-desc">Description</Label><Input id="m-desc" value={description} onChange={(e) => setDescription(e.target.value)} data-testid="job-description" /></div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={preventive} onChange={(e) => setPreventive(e.target.checked)} className="size-4 rounded border-input accent-primary" data-testid="job-preventive" />
              Preventive (scheduled)
            </label>
            {preventive && (
              <div className="space-y-1.5">
                <Label htmlFor="m-sched" className="sr-only">Scheduled date</Label>
                <Input id="m-sched" type="date" value={scheduledFor} onChange={(e) => setScheduledFor(e.target.value)} className="w-44" data-testid="job-scheduled" />
              </div>
            )}
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <Button size="lg" disabled={pending || !description || (preventive && !scheduledFor)}
            onClick={() =>
              run(
                () =>
                  createJob({
                    propertyId,
                    category,
                    description,
                    isPreventive: preventive,
                    ...(preventive && scheduledFor ? { scheduledFor } : {}),
                  }),
                () => {
                  setDescription("");
                  setPreventive(false);
                  setScheduledFor("");
                },
              )
            }
            data-testid="job-save">Create job</Button>
        </CardContent>
      </Card>

      {upcomingPreventive.length > 0 && (
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Preventive schedule</CardTitle></CardHeader>
          <CardContent>
            <ul className="divide-y rounded-md border" data-testid="preventive-list">
              {upcomingPreventive.map((j) => (
                <li key={j.id} className="flex items-center justify-between gap-2 p-3 text-sm" data-testid={`preventive-${j.id}`}>
                  <div>
                    <p className="font-medium">{j.category}{j.roomNumber ? ` · Room ${j.roomNumber}` : ""}</p>
                    <p className="text-xs text-muted-foreground">{j.description}</p>
                  </div>
                  <span className="shrink-0 rounded-md bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">
                    Due {fmtDate(j.scheduledFor)}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Jobs</CardTitle></CardHeader>
        <CardContent>
          {jobs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No maintenance jobs.</p>
          ) : (
            <ul className="divide-y rounded-md border" data-testid="job-list">
              {jobs.map((j) => <JobRow key={j.id} job={j} pending={pending} run={run} />)}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function JobRow({ job, pending, run }: { job: MaintenanceJobItem; pending: boolean; run: (fn: () => Promise<{ ok: boolean; error?: { message: string } }>, onOk?: () => void) => void }) {
  const [cost, setCost] = useState(0);
  const [vendor, setVendor] = useState("");
  const [showBlock, setShowBlock] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const canBlock = job.roomId !== null && !job.hasBlock && job.status !== "CLOSED";

  return (
    <li className="space-y-2 p-3 text-sm" data-testid={`job-${job.id}`}>
      <div>
        <p className="font-medium">{job.category}{job.roomNumber ? ` · Room ${job.roomNumber}` : ""} · {job.priority}</p>
        <p className="text-xs text-muted-foreground">{job.description} · {job.status}{job.hasBlock ? " · 🚫 blocked" : ""}{job.costPaise != null ? ` · ${rupees(job.costPaise)}` : ""}{job.vendor ? ` · ${job.vendor}` : ""}</p>
      </div>
      {job.status !== "CLOSED" && (
        <div className="flex flex-wrap items-center gap-2">
          {job.status === "OPEN" && <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => startJob({ jobId: job.id }))} data-testid={`start-${job.id}`}>Start</Button>}
          {canBlock && !showBlock && (
            <Button size="sm" variant="outline" disabled={pending} onClick={() => setShowBlock(true)} data-testid={`block-${job.id}`}>Block room</Button>
          )}
          <Input type="number" inputMode="numeric" className="w-24" placeholder="Cost ₹" value={cost || ""} onChange={(e) => setCost(Number(e.target.value))} data-testid={`cost-${job.id}`} />
          <Input className="w-36" placeholder="Vendor" value={vendor} onChange={(e) => setVendor(e.target.value)} data-testid={`vendor-${job.id}`} />
          <Button size="sm" disabled={pending} onClick={() => run(() => closeJob({ jobId: job.id, costPaise: cost > 0 ? toPaise(cost) : undefined, vendor: vendor.trim() || undefined }))} data-testid={`close-${job.id}`}>Close</Button>
        </div>
      )}
      {showBlock && (
        <div className="flex flex-wrap items-end gap-2 rounded-md border bg-muted/30 p-2">
          <div className="space-y-1">
            <Label htmlFor={`bs-${job.id}`} className="text-xs">From</Label>
            <Input id={`bs-${job.id}`} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-40" data-testid={`block-start-${job.id}`} />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`be-${job.id}`} className="text-xs">To</Label>
            <Input id={`be-${job.id}`} type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-40" data-testid={`block-end-${job.id}`} />
          </div>
          <Button
            size="sm"
            disabled={pending || !startDate || !endDate}
            onClick={() => run(() => blockRoomForJob({ jobId: job.id, startDate, endDate }), () => setShowBlock(false))}
            data-testid={`block-confirm-${job.id}`}
          >
            Confirm block
          </Button>
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => setShowBlock(false)}>Cancel</Button>
        </div>
      )}
    </li>
  );
}
