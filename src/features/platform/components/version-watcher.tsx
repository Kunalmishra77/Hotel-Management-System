"use client";

/**
 * Notices a new deployment while a tab is open (client, 15 Nov 2026). An old
 * tab's buttons call server actions the new build no longer has, so they
 * silently fail — staff read that as "the app is slow / stuck". Checks the
 * build tag every minute and whenever the tab comes back into view: a hidden
 * tab reloads itself; a tab in use shows a one-tap Refresh bar instead, so
 * nothing being typed is lost.
 */
import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";

async function currentBuild(): Promise<string | null> {
  try {
    const res = await fetch("/api/version", { cache: "no-store" });
    if (!res.ok) return null;
    const j = (await res.json()) as { build?: string };
    return j.build ?? null;
  } catch {
    return null; // offline / transient — try again later
  }
}

export function VersionWatcher() {
  const first = useRef<string | null>(null);
  const [stale, setStale] = useState(false);

  useEffect(() => {
    let alive = true;
    const check = async () => {
      const b = await currentBuild();
      if (!alive || !b) return;
      if (first.current === null) { first.current = b; return; }
      if (b !== first.current) {
        if (document.visibilityState === "hidden") window.location.reload();
        else setStale(true);
      }
    };
    void check();
    const t = window.setInterval(check, 60_000);
    const onVis = () => { if (document.visibilityState === "visible") void check(); };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onVis);
    return () => {
      alive = false;
      window.clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onVis);
    };
  }, []);

  if (!stale) return null;
  return (
    <div role="status" className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+4.5rem)] z-[60] flex justify-center px-4 md:bottom-6">
      <div className="flex items-center gap-3 rounded-full border bg-card px-4 py-2 text-sm shadow-lg">
        <span>A new version of Woodpecker PMS is ready.</span>
        <button type="button" onClick={() => window.location.reload()} className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-primary px-3 font-medium text-primary-foreground hover:opacity-90" data-testid="version-refresh">
          <RefreshCw className="size-3.5" aria-hidden="true" /> Refresh
        </button>
      </div>
    </div>
  );
}
