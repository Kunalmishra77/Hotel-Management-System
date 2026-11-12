"use client";

/**
 * PMS Agent chat (client, 12 Nov 2026) — the floating assistant and the AI page.
 * Answers from the platform's own live data, no external AI: arrivals, check-outs,
 * who is staying / in a room, free rooms, a guest or booking, dues, revenue,
 * occupancy, and how to do things in the app. Every result links to its screen.
 */
import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { askAgent } from "../actions";
import type { AgentAnswer } from "../agent";

type Turn = { q: string; a?: AgentAnswer; error?: string };

export function PmsAgent({ suggestions, compact = false }: { suggestions: readonly string[]; compact?: boolean }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [turns]);

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

  return (
    <div className="flex min-h-0 flex-col gap-3" data-testid="pms-agent">
      {turns.length === 0 && (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            Ask about bookings, guests, rooms, dues or how to do something — in English or Hindi. Answers come from your live data.
          </p>
          <div className="flex flex-wrap gap-2">
            {suggestions.map((s) => (
              <button key={s} type="button" onClick={() => ask(s)} className="rounded-full border px-3 py-1.5 text-xs hover:bg-accent" data-testid="agent-suggestion">
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className={compact ? "space-y-3" : "max-h-[60vh] space-y-3 overflow-y-auto"}>
        {turns.map((t, i) => (
          <div key={i} className="space-y-1.5">
            <p className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-sm text-primary-foreground">{t.q}</p>
            {t.error ? (
              <p role="alert" className="w-fit max-w-[95%] rounded-2xl rounded-bl-sm border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">{t.error}</p>
            ) : t.a ? (
              <div className="w-fit max-w-[95%] space-y-2 rounded-2xl rounded-bl-sm border bg-muted/40 px-3 py-2 text-sm" data-testid="agent-answer">
                <p>{t.a.answer}</p>
                {t.a.steps && (
                  <ol className="list-decimal space-y-1 pl-5">
                    {t.a.steps.map((s, k) => <li key={k}>{s}</li>)}
                  </ol>
                )}
                {t.a.items && t.a.items.length > 0 && (
                  <ul className="space-y-1.5">
                    {t.a.items.map((it, k) => (
                      <li key={k} className="rounded-lg border bg-background px-2.5 py-1.5">
                        {it.href ? <Link href={it.href} className="font-medium text-primary underline-offset-2 hover:underline">{it.title}</Link> : <span className="font-medium">{it.title}</span>}
                        <p className="text-xs text-muted-foreground">{it.subtitle}</p>
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

      <form onSubmit={(e) => { e.preventDefault(); ask(text); }} className="flex gap-2">
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. 2F-3 me kaun hai? · aaj ke check-out · Saumen" className="h-11" data-testid="agent-input" />
        <Button type="submit" disabled={pending || !text.trim()} className="h-11" aria-label="Ask"><Send /></Button>
      </form>
    </div>
  );
}
