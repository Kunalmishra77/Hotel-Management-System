"use client";

/**
 * Registers the service worker (17 T-2). Production only: a caching SW fights
 * Next's HMR in dev, so there we proactively unregister any stale SW instead.
 * Registration failure is swallowed — offline support is an enhancement and must
 * never break the app.
 */
import { useEffect } from "react";

export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    if (process.env.NODE_ENV !== "production") {
      void navigator.serviceWorker
        .getRegistrations()
        .then((regs) => regs.forEach((r) => void r.unregister()))
        .catch(() => {});
      return;
    }

    const onLoad = () => {
      void navigator.serviceWorker.register("/sw.js").catch(() => {});
    };
    window.addEventListener("load", onLoad);
    return () => window.removeEventListener("load", onLoad);
  }, []);

  return null;
}
