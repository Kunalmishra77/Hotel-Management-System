"use client";
/**
 * Floating AI assistant (architecture v2 · Phase 7). The blueprint wants AI as a
 * floating helper across every portal — not a separate page. This mounts a
 * bottom-right launcher that opens a panel embedding the existing Ask-PMS
 * assistant. Rendered app-wide (gated to `ai:use` by the shell).
 */
import { useState } from "react";
import { Bot, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { AskPms } from "./ask-pms";

export function AiLauncher() {
  const [open, setOpen] = useState(false);

  return (
    <>
      {open && (
        <>
          {/* Tap-outside scrim (mobile). */}
          <div className="fixed inset-0 z-40 bg-black/20 md:bg-transparent" aria-hidden="true" onClick={() => setOpen(false)} />
          <div
            role="dialog"
            aria-label="AI assistant"
            className={cn(
              "fixed z-50 flex max-h-[75dvh] flex-col overflow-hidden rounded-2xl border bg-card shadow-2xl",
              "inset-x-3 bottom-24 md:inset-x-auto md:right-5 md:bottom-24 md:w-[26rem]",
            )}
          >
            <div className="flex items-center justify-between border-b px-4 py-2.5">
              <span className="inline-flex items-center gap-2 text-sm font-semibold">
                <Bot className="size-4 text-primary" aria-hidden="true" /> Assistant
              </span>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close assistant" className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
                <X className="size-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <AskPms />
            </div>
          </div>
        </>
      )}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "Close assistant" : "Open assistant"}
        className={cn(
          "fixed right-4 bottom-[calc(env(safe-area-inset-bottom)+4.75rem)] z-50 grid size-12 place-items-center rounded-full shadow-lg md:right-5 md:bottom-6",
          "bg-primary text-primary-foreground transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        )}
      >
        {open ? <X className="size-5" /> : <Bot className="size-5" />}
      </button>
    </>
  );
}
