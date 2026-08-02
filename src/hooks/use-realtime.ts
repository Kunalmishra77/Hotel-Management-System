"use client";

/**
 * Subscribe to the platform realtime channel — 01 T-12 (FR-7, AC-7).
 *
 * On a matching event the hook calls `router.refresh()`, so the Server
 * Component re-runs its own authorized query and re-renders. The socket never
 * carries data, only a nudge — which is why no scope or PII check is needed on
 * the client: it learns *that* something changed, never *what*.
 *
 * Spec 17 owns the richer transport (LISTEN/NOTIFY source, reconnect/backoff,
 * offline queue). This is the consumer side and will not change when it lands.
 */
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

export type RealtimeEvent = {
  type: string;
  propertyId: string | null;
  aggregateId: string;
};

export function useRealtime(options: {
  /** Event types to react to. */
  types: readonly string[];
  /** Restrict to one property; omit to accept any in scope. */
  propertyId?: string | null;
  /** Coalesce bursts — a check-in can emit several events at once. */
  debounceMs?: number;
}): void {
  const router = useRouter();
  const { types, propertyId, debounceMs = 250 } = options;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Keep the latest values without re-subscribing on every render.
  const matcher = useRef({ types, propertyId });
  matcher.current = { types, propertyId };

  useEffect(() => {
    // EventSource is absent during SSR and in older embedded webviews; the page
    // simply stays static rather than erroring.
    if (typeof window === "undefined" || typeof EventSource === "undefined") return;

    const source = new EventSource("/api/realtime");

    const onDomain = (message: MessageEvent<string>) => {
      let event: RealtimeEvent;
      try {
        event = JSON.parse(message.data) as RealtimeEvent;
      } catch {
        return;
      }

      const { types: wanted, propertyId: wantedProperty } = matcher.current;
      if (!wanted.includes(event.type)) return;
      if (wantedProperty && event.propertyId && event.propertyId !== wantedProperty) return;

      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => router.refresh(), debounceMs);
    };

    source.addEventListener("domain", onDomain as EventListener);

    return () => {
      source.removeEventListener("domain", onDomain as EventListener);
      source.close();
      if (timer.current) clearTimeout(timer.current);
    };
    // `types`/`propertyId` are read through the ref, so the subscription is
    // established once rather than torn down whenever a parent re-renders.
  }, [router, debounceMs]);
}
