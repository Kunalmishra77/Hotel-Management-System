"use client";
/** Resolve a stored item — claimed (with who) or disposed (Phase 7). */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { resolveLostItem } from "../actions";

export function ResolveLostItem({ id }: { id: string }) {
  const router = useRouter();
  const [claiming, setClaiming] = useState(false);
  const [claimant, setClaimant] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function resolve(status: "CLAIMED" | "DISPOSED") {
    setError(null);
    startTransition(async () => {
      const res = await resolveLostItem({ id, status, claimantName: status === "CLAIMED" ? claimant || undefined : undefined });
      if (!res.ok) {
        setError(res.error.message);
        return;
      }
      router.refresh();
    });
  }

  if (claiming) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={claimant}
          onChange={(e) => setClaimant(e.target.value)}
          placeholder="Collected by (name)"
          className="h-8 w-44"
        />
        <Button size="sm" disabled={pending} onClick={() => resolve("CLAIMED")}>
          Confirm claim
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setClaiming(false)} disabled={pending}>
          Cancel
        </Button>
        {error && <span className="text-xs text-destructive">{error}</span>}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" onClick={() => setClaiming(true)} disabled={pending}>
        Mark claimed
      </Button>
      <Button size="sm" variant="outline" onClick={() => resolve("DISPOSED")} disabled={pending}>
        Dispose
      </Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}
