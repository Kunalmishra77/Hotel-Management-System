"use client";
/** Change the org's plan (architecture v2 · SaaS). */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { changePlan } from "../actions";

export function PlanSwitch({ plan, isCurrent }: { plan: "CORE" | "GROWTH" | "ENTERPRISE"; isCurrent: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function switchTo() {
    setError(null);
    start(async () => {
      const res = await changePlan({ plan });
      if (!res.ok) return setError(res.error.message);
      router.refresh();
    });
  }

  if (isCurrent) {
    return <Button variant="outline" size="sm" disabled className="mt-5 w-full">Current plan</Button>;
  }
  return (
    <div className="mt-5">
      <Button size="sm" className="w-full" onClick={switchTo} disabled={pending}>
        {pending ? "Switching…" : "Switch to this plan"}
      </Button>
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}
