"use client";

/**
 * Connectivity indicator (17 T-8, FR-6). Self-contained: tracks the browser's
 * online/offline state and shows a pill only when offline — staff need to know
 * their taps are being queued, not reassured when everything is normal.
 */
import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";

export function ConnectivityBadge() {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    setOnline(navigator.onLine);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  if (online) return null;
  return (
    <span
      role="status"
      data-testid="offline-banner"
      className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-3 py-1 text-xs font-medium text-warning"
    >
      <WifiOff className="size-3.5" aria-hidden="true" />
      Offline — changes will sync
    </span>
  );
}
