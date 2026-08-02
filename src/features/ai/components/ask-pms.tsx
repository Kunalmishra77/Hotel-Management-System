"use client";

/**
 * 18 T-12 — the Ask-PMS bar (AC-3/4). Mobile-first. Sends a natural-language
 * query to `askPms`, which compiles it to a 15 structured query, runs it with
 * the caller's scope, and returns MASKED result cards. No raw PII ever reaches
 * the client. A parallel "ask the assistant" chat mode calls `chatWithPms`.
 */
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { askPms, chatWithPms } from "../actions";

type Row = { entity: string; id: string; title: string; subtitle?: string; fields: Record<string, string | number | null> };

export function AskPms() {
  const [text, setText] = useState("");
  const [mode, setMode] = useState<"search" | "chat">("search");
  const [rows, setRows] = useState<Row[]>([]);
  const [answer, setAnswer] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    setAnswer("");
    setRows([]);
    try {
      if (mode === "search") {
        const res = await askPms({ text });
        if (res.ok) setRows(res.data.results as Row[]);
        else setError(res.error.message);
      } else {
        const res = await chatWithPms({ message: text });
        if (res.ok) setAnswer(res.data.answer);
        else setError(res.error.message);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2 text-sm">
        <button
          type="button"
          onClick={() => setMode("search")}
          className={`rounded-md px-3 py-1 ${mode === "search" ? "bg-primary text-primary-foreground" : "border"}`}
          data-testid="ask-mode-search"
        >
          NL search
        </button>
        <button
          type="button"
          onClick={() => setMode("chat")}
          className={`rounded-md px-3 py-1 ${mode === "chat" ? "bg-primary text-primary-foreground" : "border"}`}
          data-testid="ask-mode-chat"
        >
          Assistant
        </button>
      </div>

      <form onSubmit={run} className="flex gap-2">
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={mode === "search" ? "e.g. guests from Bangalore" : "Ask about rooms, policies…"}
          aria-label="Ask PMS"
          data-testid="ask-input"
        />
        <Button type="submit" disabled={busy} data-testid="ask-submit">
          {busy ? "…" : "Ask"}
        </Button>
      </form>

      {error && <p className="text-sm text-destructive" data-testid="ask-error">{error}</p>}

      {answer && (
        <p className="rounded-md border p-3 text-sm" data-testid="ask-answer">
          {answer}
        </p>
      )}

      {rows.length > 0 && (
        <ul className="space-y-2" data-testid="ask-results">
          {rows.map((r) => (
            <li key={`${r.entity}-${r.id}`} className="rounded-md border p-3 text-sm" data-testid={`ask-result-${r.entity}`}>
              <div className="font-medium">{r.title}</div>
              {r.subtitle && <div className="text-muted-foreground">{r.subtitle}</div>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
