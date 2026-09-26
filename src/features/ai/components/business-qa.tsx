"use client";

/**
 * 18 ⑬ — the grounded business assistant. Ask an operational question in plain
 * language and get a real answer computed from live data (dues, revenue, occupancy,
 * cancellations, rooms to clean…), with a per-property breakdown when relevant.
 * Suggestion chips make the common questions one tap. Read-only; the answer text
 * and figures come from the server resolver, never fabricated on the client.
 */
import { useState } from "react";
import { Sparkles, Send } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { askBusiness } from "../actions";
import type { BusinessAnswer } from "../business-qa";

export function BusinessQa({ suggestions }: { suggestions: readonly string[] }) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState<BusinessAnswer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ask(question: string) {
    if (!question.trim()) return;
    setBusy(true);
    setError(null);
    const r = await askBusiness({ question });
    setBusy(false);
    if (r.ok) setRes(r.data);
    else setError(r.error.message);
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base [&_svg]:size-4 [&_svg]:text-primary">
          <Sparkles /> Ask about your business
        </CardTitle>
        <p className="text-sm text-muted-foreground">Real answers from live data — dues, revenue, occupancy, cancellations, rooms to clean. Scoped to what you can see.</p>
      </CardHeader>
      <CardContent className="space-y-3">
        <form onSubmit={(e) => { e.preventDefault(); void ask(q); }} className="flex gap-2">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. Today's pending dues?" aria-label="Ask a business question" data-testid="business-qa-input" />
          <Button type="submit" disabled={busy} data-testid="business-qa-submit"><Send className="size-4" /> {busy ? "…" : "Ask"}</Button>
        </form>

        <div className="flex flex-wrap gap-1.5">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => { setQ(s); void ask(s); }}
              disabled={busy}
              className="rounded-full border bg-muted/40 px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground disabled:opacity-60"
              data-testid="business-qa-chip"
            >
              {s}
            </button>
          ))}
        </div>

        {error && <p className="text-sm text-destructive" data-testid="business-qa-error">{error}</p>}

        {res && (
          <div className="rounded-lg border bg-muted/20 p-3" data-testid="business-qa-answer">
            <p className="text-sm">{res.answer}</p>
            {res.breakdown && res.breakdown.length > 0 && (
              <ul className="mt-3 space-y-1 border-t pt-2 text-sm">
                {res.breakdown.map((b) => (
                  <li key={b.label} className="flex items-baseline justify-between gap-3">
                    <span className="text-muted-foreground">{b.label}</span>
                    <span className="tabular font-medium">{b.value}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
