"use client";

/**
 * Housekeeping task board — 10 T-9/T-10 (FR-3/4, AC-1/2/4/5). Mobile-first,
 * one-thumb. Offline-aware via the durable IndexedDB queue (17 T-3/4/5): a
 * "mark clean" made offline is enqueued with its `clientUpdatedAt` and shown as
 * pending-sync; on reconnect — or on next open, since IndexedDB survives an app
 * kill — the queue flushes in order. Each write re-runs the server's conflict +
 * transition guards, so a STALE write is surfaced as a conflict, never applied.
 */
import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { enqueue, flush, pending, type Resolver } from "@/lib/offline";
import { updateTaskStatus } from "../actions";
import type { HousekeepingTaskItem } from "../queries";

const HK_KIND = "housekeeping:status";
type HkPayload = { taskId: string; status: "DONE" | "IN_PROGRESS"; clientUpdatedAt: string };

/** Any domain rejection is permanent for a queued write (the room's state moved
 *  on); only a thrown network error becomes a retry, handled inside `flush`. */
const hkResolver: Resolver = async (payload) => {
  const p = payload as HkPayload;
  const res = await updateTaskStatus({ taskId: p.taskId, status: p.status, clientUpdatedAt: p.clientUpdatedAt });
  return res.ok ? "applied" : "conflict";
};

export function HousekeepingBoard({ tasks }: { tasks: HousekeepingTaskItem[] }) {
  const router = useRouter();
  const [pendingAction, start] = useTransition();
  const [online, setOnline] = useState(true);
  const [queuedIds, setQueuedIds] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  const refreshQueued = useCallback(async () => {
    const items = await pending(HK_KIND);
    setQueuedIds(items.map((m) => (m.payload as HkPayload).taskId));
  }, []);

  const runFlush = useCallback(async () => {
    setOnline(true);
    const r = await flush({ [HK_KIND]: hkResolver });
    await refreshQueued();
    if (r.conflicts > 0) setMessage(`${r.conflicts} update(s) were out of date and need a re-check.`);
    if (r.applied > 0) router.refresh();
  }, [refreshQueued, router]);

  useEffect(() => {
    setOnline(navigator.onLine);
    void refreshQueued();
    // Drain anything left from a previous (possibly killed) session.
    if (navigator.onLine) void runFlush();

    const onOnline = () => void runFlush();
    const onOffline = () => setOnline(false);
    const onVisible = () => {
      if (document.visibilityState === "visible" && navigator.onLine) void runFlush();
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refreshQueued, runFlush]);

  const markClean = (taskId: string) => {
    setMessage(null);
    if (!navigator.onLine) {
      void enqueue(HK_KIND, {
        taskId,
        status: "DONE",
        clientUpdatedAt: new Date().toISOString(),
      } satisfies HkPayload).then(refreshQueued);
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
        {!online && (
          <span
            className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800"
            data-testid="offline-banner"
          >
            Offline — changes will sync
          </span>
        )}
      </div>
      {message && (
        <p role="alert" className="text-sm text-destructive" data-testid="hk-message">
          {message}
        </p>
      )}

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
                        {t.status}
                        {isQueued ? " · pending sync" : ""}
                        {t.hasMaintenanceJob ? " · 🔧 job raised" : ""}
                      </p>
                    </div>
                    {t.status !== "DONE" && !isQueued && (
                      <Button
                        size="lg"
                        disabled={pendingAction}
                        onClick={() => markClean(t.id)}
                        data-testid={`clean-${t.roomNumber}`}
                      >
                        Mark clean
                      </Button>
                    )}
                    {isQueued && (
                      <span className="text-sm text-amber-700" data-testid={`queued-${t.roomNumber}`}>
                        ⏳ queued
                      </span>
                    )}
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
