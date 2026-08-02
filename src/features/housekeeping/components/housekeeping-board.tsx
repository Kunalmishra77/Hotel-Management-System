"use client";

/**
 * Housekeeping task board — 10 T-9/T-10 (FR-3/4, AC-1/2/4/5). Mobile-first,
 * one-thumb. Offline-aware: when the device is offline a "mark clean" is queued
 * in localStorage with its `clientUpdatedAt` and shown as pending-sync; on
 * reconnect the queue flushes through `syncOfflineUpdates`, where the server's
 * conflict + transition guards decide what actually applies (a stale write is
 * surfaced, never silently applied).
 *
 * NOTE: this uses the online/offline events + localStorage. Full service-worker
 * background sync (survives an app close) is the 17-mobile-experience concern —
 * see the 10 review R-note.
 */
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { updateTaskStatus, syncOfflineUpdates } from "../actions";
import type { HousekeepingTaskItem } from "../queries";

const QUEUE_KEY = "hk-offline-queue";
type Queued = { taskId: string; status: "DONE" | "IN_PROGRESS"; clientUpdatedAt: string };

function readQueue(): Queued[] {
  try { return JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "[]"); } catch { return []; }
}
function writeQueue(q: Queued[]): void { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); }

export function HousekeepingBoard({ tasks }: { tasks: HousekeepingTaskItem[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [online, setOnline] = useState(true);
  const [queuedIds, setQueuedIds] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setOnline(navigator.onLine);
    setQueuedIds(readQueue().map((q) => q.taskId));
    const flush = async () => {
      setOnline(true);
      const q = readQueue();
      if (q.length === 0) return;
      const res = await syncOfflineUpdates({ updates: q });
      writeQueue([]);
      setQueuedIds([]);
      if (res.ok && res.data.conflicts.length > 0) setMessage(`${res.data.conflicts.length} update(s) were out of date and need a re-check.`);
      router.refresh();
    };
    const goOffline = () => setOnline(false);
    window.addEventListener("online", flush);
    window.addEventListener("offline", goOffline);
    return () => { window.removeEventListener("online", flush); window.removeEventListener("offline", goOffline); };
  }, [router]);

  const markClean = (taskId: string) => {
    setMessage(null);
    if (!navigator.onLine) {
      const q = readQueue();
      q.push({ taskId, status: "DONE", clientUpdatedAt: new Date().toISOString() });
      writeQueue(q);
      setQueuedIds(q.map((x) => x.taskId));
      return;
    }
    start(async () => {
      const res = await updateTaskStatus({ taskId, status: "DONE" });
      if (res.ok) router.refresh();
      else setMessage(res.error.message);
    });
  };

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Housekeeping</h1>
        {!online && <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800" data-testid="offline-banner">Offline — changes will sync</span>}
      </div>
      {message && <p role="alert" className="text-sm text-destructive" data-testid="hk-message">{message}</p>}

      {tasks.length === 0 ? (
        <p className="text-sm text-muted-foreground">No cleaning tasks right now.</p>
      ) : (
        <ul className="space-y-2" data-testid="task-board">
          {tasks.map((t) => {
            const isQueued = queuedIds.includes(t.id);
            return (
              <li key={t.id}>
                <Card data-testid={`task-${t.roomNumber}`}>
                  <CardContent className="flex items-center justify-between gap-2 p-3">
                    <div>
                      <p className="font-medium">Room {t.roomNumber}</p>
                      <p className="text-xs text-muted-foreground">
                        {t.status}{isQueued ? " · pending sync" : ""}{t.hasMaintenanceJob ? " · 🔧 job raised" : ""}
                      </p>
                    </div>
                    {t.status !== "DONE" && !isQueued && (
                      <Button size="lg" disabled={pending} onClick={() => markClean(t.id)} data-testid={`clean-${t.roomNumber}`}>
                        Mark clean
                      </Button>
                    )}
                    {isQueued && <span className="text-sm text-amber-700" data-testid={`queued-${t.roomNumber}`}>⏳ queued</span>}
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
