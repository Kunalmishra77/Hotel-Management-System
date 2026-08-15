"use client";
/** Pass / fail a room inspection (architecture v2 · Phase 5). */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { recordInspection } from "../actions";

export function InspectControl({ roomId }: { roomId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [failing, setFailing] = useState(false);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  function record(status: "PASS" | "FAIL") {
    setError(null);
    start(async () => {
      const res = await recordInspection({ roomId, status, defectNotes: status === "FAIL" ? notes.trim() || undefined : undefined });
      if (!res.ok) return setError(res.error.message);
      router.refresh();
    });
  }

  if (failing) {
    return (
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="What's wrong? (defect note)"
          maxLength={500}
          className="min-h-touch flex-1 rounded-md border bg-background px-3 text-sm"
        />
        <div className="flex gap-2">
          <Button size="sm" variant="destructive" onClick={() => record("FAIL")} disabled={pending}>{pending ? "…" : "Fail → re-clean"}</Button>
          <Button size="sm" variant="ghost" onClick={() => setFailing(false)} disabled={pending}>Cancel</Button>
        </div>
        {error && <span className="text-xs text-destructive">{error}</span>}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Button size="sm" onClick={() => record("PASS")} disabled={pending}><Check className="size-4" /> Pass</Button>
      <Button size="sm" variant="outline" onClick={() => setFailing(true)} disabled={pending}><X className="size-4" /> Fail</Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}
