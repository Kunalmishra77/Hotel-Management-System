"use client";

/**
 * PMS Agent chat (client, 12 Nov 2026) — answers from the platform's own live
 * data (no external AI) AND does things: a command becomes a plan with a Confirm
 * button; nothing changes until the user confirms, and then it runs through the
 * same server action as the screen. The conversation is kept per user on this
 * device (localStorage), so it's still there when the panel is reopened.
 */
import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Send, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { askAgent, runAgentCommand } from "../actions";
import type { AgentAnswer } from "../agent";
import type { AgentProposal } from "../agent-commands";

type Ran = { state: "done" | "failed" | "cancelled"; message: string };
type Turn = { q: string; a?: AgentAnswer; error?: string; ran?: Record<string, Ran> };

const MAX_TURNS = 60;
function load(key?: string): Turn[] {
  if (!key) return [];
  try { const raw = localStorage.getItem(key); return raw ? (JSON.parse(raw) as Turn[]) : []; } catch { return []; }
}

export function PmsAgent({ suggestions, storageKey, compact = false }: { suggestions: readonly string[]; storageKey?: string; compact?: boolean }) {
  const router = useRouter();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  const [running, setRunning] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => { setTurns(load(storageKey)); }, [storageKey]);
  useEffect(() => {
    if (storageKey) { try { localStorage.setItem(storageKey, JSON.stringify(turns.slice(-MAX_TURNS))); } catch { /* storage off — chat still works */ } }
    end.current?.scrollIntoView({ block: "end" });
  }, [turns, storageKey]);

  const ask = (question: string) => {
    const q = question.trim();
    if (!q || pending) return;
    setText("");
    setTurns((t) => [...t, { q }]);
    start(async () => {
      const res = await askAgent({ question: q });
      setTurns((t) => t.map((x, i) => (i === t.length - 1 ? (res.ok ? { q, a: res.data } : { q, error: res.error.message }) : x)));
    });
  };

  const mark = (turn: number, key: string, ran: Ran) =>
    setTurns((t) => t.map((x, i) => (i === turn ? { ...x, ran: { ...(x.ran ?? {}), [key]: ran } } : x)));

  const confirm = async (turn: number, key: string, p: AgentProposal) => {
    setRunning(`${turn}:${key}`);
    try {
      const res = await runAgentCommand(p.command);
      mark(turn, key, res.ok ? { state: "done", message: res.data.message } : { state: "failed", message: res.error.message });
      if (res.ok) router.refresh(); // the page behind the panel shows the change
    } finally {
      setRunning(null);
    }
  };

  const ProposalBox = ({ turn, k, p }: { turn: number; k: string; p: AgentProposal }) => {
    const ran = turns[turn]?.ran?.[k];
    const busy = running === `${turn}:${k}`;
    return (
      <div className="space-y-2 rounded-lg border border-primary/40 bg-background p-2.5" data-testid="agent-proposal">
        <p className="text-sm">{p.summary}</p>
        {ran ? (
          <p className={ran.state === "done" ? "text-sm font-medium text-success" : ran.state === "failed" ? "text-sm text-destructive" : "text-sm text-muted-foreground"} role={ran.state === "failed" ? "alert" : undefined}>
            {ran.state === "done" ? "✓ " : ran.state === "failed" ? "✗ " : ""}{ran.message}
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={busy} onClick={() => void confirm(turn, k, p)} data-testid="agent-confirm"><Check /> {busy ? "Working…" : p.confirmLabel}</Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => mark(turn, k, { state: "cancelled", message: "Cancelled — nothing changed." })}><X /> Cancel</Button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3" data-testid="pms-agent">
      <div className={compact ? "min-h-0 flex-1 space-y-3 overflow-y-auto pr-1" : "max-h-[60vh] space-y-3 overflow-y-auto pr-1"}>
        {turns.length === 0 && (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Ask anything about your hotels, or tell me what to do — in English or Hindi. I show the plan and do it only when you press Confirm.
            </p>
            <div className="flex flex-wrap gap-2">
              {suggestions.map((s) => (
                <button key={s} type="button" onClick={() => ask(s)} className="rounded-full border px-3 py-1.5 text-xs hover:bg-accent" data-testid="agent-suggestion">{s}</button>
              ))}
            </div>
          </div>
        )}
        {turns.map((t, i) => (
          <div key={i} className="space-y-1.5">
            <p className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-sm text-primary-foreground">{t.q}</p>
            {t.error ? (
              <p role="alert" className="w-fit max-w-[95%] rounded-2xl rounded-bl-sm border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">{t.error}</p>
            ) : t.a ? (
              <div className="w-fit max-w-[98%] space-y-2 rounded-2xl rounded-bl-sm border bg-muted/40 px-3 py-2 text-sm" data-testid="agent-answer">
                <p>{t.a.answer}</p>
                {t.a.steps && <ol className="list-decimal space-y-1 pl-5">{t.a.steps.map((s, k) => <li key={k}>{s}</li>)}</ol>}
                {t.a.proposal && <ProposalBox turn={i} k="main" p={t.a.proposal} />}
                {t.a.items && t.a.items.length > 0 && (
                  <ul className="space-y-1.5">
                    {t.a.items.map((it, k) => (
                      <li key={k} className="space-y-1.5 rounded-lg border bg-background px-2.5 py-1.5">
                        {it.href ? <Link href={it.href} className="font-medium text-primary underline-offset-2 hover:underline">{it.title}</Link> : <span className="font-medium">{it.title}</span>}
                        <p className="text-xs text-muted-foreground">{it.subtitle}</p>
                        {it.proposal && <ProposalBox turn={i} k={`item-${k}`} p={it.proposal} />}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              <p className="w-fit rounded-2xl rounded-bl-sm border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">Checking…</p>
            )}
          </div>
        ))}
        <div ref={end} />
      </div>

      <form onSubmit={(e) => { e.preventDefault(); ask(text); }} className="flex shrink-0 gap-2">
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask or instruct — e.g. BK-… ko 8 Dec tak extend karo" className="h-11" data-testid="agent-input" />
        <Button type="submit" disabled={pending || !text.trim()} className="h-11" aria-label="Send"><Send /></Button>
        {turns.length > 0 && (
          <Button type="button" variant="ghost" className="h-11" aria-label="Clear chat" title="Clear chat" onClick={() => setTurns([])}><Trash2 /></Button>
        )}
      </form>
    </div>
  );
}
