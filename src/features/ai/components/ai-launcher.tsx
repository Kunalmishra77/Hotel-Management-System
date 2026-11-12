"use client";
/**
 * PMS Agent panel (client, 12 Nov 2026 — "right side bar me open jaise Hostinger").
 * Desktop: a panel docked on the right that sits BESIDE the page (the page narrows,
 * nothing is covered), so staff can keep working while they chat. Phone: a sheet
 * over the page. It remembers whether it was open, and the chat history per user.
 * Rendered inside the shell's main row (gated to `ai:use` by the shell).
 */
import { useEffect, useState } from "react";
import { Bot, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { PmsAgent } from "./pms-agent";
import { AGENT_SUGGESTIONS } from "../domain/agent-intents";

const OPEN_KEY = "pms-agent-open";

export function AiLauncher({ userId }: { userId?: string }) {
  const [open, setOpen] = useState(false);
  useEffect(() => { try { setOpen(localStorage.getItem(OPEN_KEY) === "1"); } catch { /* no storage */ } }, []);
  const toggle = (v: boolean) => { setOpen(v); try { localStorage.setItem(OPEN_KEY, v ? "1" : "0"); } catch { /* no storage */ } };
  const storageKey = userId ? `pms-agent-chat:${userId}` : undefined;

  const header = (
    <div className="flex shrink-0 items-center justify-between border-b px-4 py-2.5">
      <span className="inline-flex items-center gap-2 text-sm font-semibold">
        <Bot className="size-4 text-primary" aria-hidden="true" /> PMS Agent
        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">live data · no outside AI</span>
      </span>
      <button type="button" onClick={() => toggle(false)} aria-label="Close agent" className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
        <X className="size-4" />
      </button>
    </div>
  );

  return (
    <>
      {open && (
        <>
          {/* Desktop: docked beside the page. */}
          <aside aria-label="PMS Agent" className="hidden h-full w-[27rem] shrink-0 flex-col border-l bg-card md:flex" data-testid="agent-panel">
            {header}
            <div className="flex min-h-0 flex-1 flex-col p-3"><PmsAgent suggestions={AGENT_SUGGESTIONS} storageKey={storageKey} compact /></div>
          </aside>
          {/* Phone: a sheet over the page. */}
          <div className="fixed inset-0 z-40 bg-black/30 md:hidden" aria-hidden="true" onClick={() => toggle(false)} />
          <div role="dialog" aria-label="PMS Agent" className="fixed inset-x-0 bottom-0 z-50 flex h-[85dvh] flex-col rounded-t-2xl border bg-card shadow-2xl md:hidden">
            {header}
            <div className="flex min-h-0 flex-1 flex-col p-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]"><PmsAgent suggestions={AGENT_SUGGESTIONS} storageKey={storageKey} compact /></div>
          </div>
        </>
      )}

      {!open && (
        <button
          type="button"
          onClick={() => toggle(true)}
          aria-label="Open PMS Agent"
          title="PMS Agent"
          className={cn(
            "fixed right-4 bottom-[calc(env(safe-area-inset-bottom)+4.75rem)] z-50 grid size-12 place-items-center rounded-full shadow-lg md:right-5 md:bottom-6",
            "bg-primary text-primary-foreground transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
          data-testid="agent-open"
        >
          <Bot className="size-5" />
        </button>
      )}
    </>
  );
}
