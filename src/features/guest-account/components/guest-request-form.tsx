"use client";
/**
 * In-room service request form (Phase 4). A checked-in guest picks a kind and
 * describes what they need; it posts to the hotel and refreshes the tracker.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { GUEST_REQUEST_KINDS, KIND_LABEL, type GuestRequestKind } from "../domain/request-kind";
import { createGuestRequest } from "../stay-actions";

export function GuestRequestForm() {
  const router = useRouter();
  const [kind, setKind] = useState<GuestRequestKind>("HOUSEKEEPING");
  const [detail, setDetail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await createGuestRequest({ kind, detail });
      if (!res.ok) {
        setError(res.error.message);
        return;
      }
      setDetail("");
      setDone(true);
      router.refresh();
      setTimeout(() => setDone(false), 3000);
    });
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        {GUEST_REQUEST_KINDS.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(k)}
            aria-pressed={kind === k}
            className={`rounded-lg border px-3 py-2 text-sm font-medium transition ${
              kind === k ? "border-primary bg-primary/5 text-primary" : "hover:border-primary/40"
            }`}
          >
            {KIND_LABEL[k]}
          </button>
        ))}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="req-detail">What do you need?</Label>
        <Textarea
          id="req-detail"
          value={detail}
          onChange={(e) => setDetail(e.target.value)}
          placeholder="e.g. Extra towels and a bottle of water, please."
          rows={3}
        />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {done && <p className="text-sm text-success">Sent — the team has been notified.</p>}

      <Button onClick={submit} disabled={pending || detail.trim().length < 3} block>
        {pending ? "Sending…" : "Send request"}
      </Button>
    </div>
  );
}
