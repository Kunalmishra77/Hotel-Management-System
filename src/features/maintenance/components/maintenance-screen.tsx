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
import { createJob, startJob, closeJob } from "../actions";
import type { MaintenanceJobItem } from "../queries";

const CATEGORIES = ["AC", "ELECTRICAL", "PLUMBING", "FURNITURE", "PAINTING", "PEST_CONTROL", "OTHER"];
const rupees = (p: number) => `₹${(p / 100).toLocaleString("en-IN")}`;
const toPaise = (r: number) => Math.round(r * 100);

export function MaintenanceScreen({ propertyId, jobs }: { propertyId: string; jobs: MaintenanceJobItem[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState("AC");
  const [description, setDescription] = useState("");

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
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <Button size="lg" disabled={pending || !description}
            onClick={() => run(() => createJob({ propertyId, category, description }), () => setDescription(""))}
            data-testid="job-save">Create job</Button>
        </CardContent>
      </Card>

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
  return (
    <li className="space-y-2 p-3 text-sm" data-testid={`job-${job.id}`}>
      <div>
        <p className="font-medium">{job.category}{job.roomNumber ? ` · Room ${job.roomNumber}` : ""} · {job.priority}</p>
        <p className="text-xs text-muted-foreground">{job.description} · {job.status}{job.hasBlock ? " · 🚫 blocked" : ""}{job.costPaise != null ? ` · ${rupees(job.costPaise)}` : ""}</p>
      </div>
      {job.status !== "CLOSED" && (
        <div className="flex flex-wrap items-center gap-2">
          {job.status === "OPEN" && <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => startJob({ jobId: job.id }))} data-testid={`start-${job.id}`}>Start</Button>}
          <Input type="number" inputMode="numeric" className="w-24" placeholder="Cost ₹" value={cost || ""} onChange={(e) => setCost(Number(e.target.value))} data-testid={`cost-${job.id}`} />
          <Button size="sm" disabled={pending} onClick={() => run(() => closeJob({ jobId: job.id, costPaise: cost > 0 ? toPaise(cost) : undefined }))} data-testid={`close-${job.id}`}>Close</Button>
        </div>
      )}
    </li>
  );
}
