"use client";

/**
 * Move a credit sitting on the other leg of this guest's stay onto this folio.
 *
 * A split stay — a transfer to another property, or an OTA stay continuing
 * direct — is billed on a folio per leg, but the guest pays once at one desk. The
 * leg that took the money ends up in credit while this one still shows a due, and
 * check-out gates folio by folio. Reception is then asked to collect money the
 * guest has already handed over. This moves it instead of collecting it twice.
 *
 * Only shown when the linked leg actually holds a credit, so it never appears as
 * an option reception has to reason about.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeftRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { moveFolioCredit } from "@/features/billing/payment-actions";
import { formatINR } from "@/lib/utils";

export function MoveCreditCard({
  fromFolioId,
  toFolioId,
  fromCode,
  creditPaise,
  duePaise,
}: {
  fromFolioId: string;
  toFolioId: string;
  /** The linked booking holding the credit, for the operator to recognise. */
  fromCode: string;
  creditPaise: number;
  duePaise: number;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const afterDue = duePaise - creditPaise;

  function submit() {
    setError(null);
    setDone(null);
    start(async () => {
      const res = await moveFolioCredit({ fromFolioId, toFolioId });
      if (!res.ok) { setError(res.error.message); return; }
      setDone(formatINR(res.data.movedPaise));
      router.refresh();
    });
  }

  return (
    <Card className="mt-4 border-emerald-600/30">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base [&_svg]:size-4 [&_svg]:text-primary">
          <ArrowLeftRight /> Credit on the earlier booking
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{fromCode}</span> — the earlier part of this
          guest&apos;s stay — is in credit by{" "}
          <span className="font-medium text-foreground">{formatINR(creditPaise)}</span>. The guest has
          already paid it, so move it here rather than collecting it again.
        </p>
        <dl className="rounded-md border bg-muted/40 p-2.5 text-sm">
          <div className="flex justify-between"><dt className="text-muted-foreground">Due on this booking now</dt><dd>{formatINR(duePaise)}</dd></div>
          <div className="flex justify-between"><dt className="text-muted-foreground">Credit to move</dt><dd>− {formatINR(creditPaise)}</dd></div>
          <div className="mt-1 flex justify-between border-t pt-1 font-medium"><dt>To collect after moving</dt><dd>{formatINR(afterDue)}</dd></div>
        </dl>
        <Button type="button" onClick={submit} disabled={pending} data-testid="move-credit-submit">
          {pending ? "Moving…" : `Move ${formatINR(creditPaise)} here`}
        </Button>
        <p className="text-xs text-muted-foreground">
          This reallocates money already received — it posts no charge, so the bill, GST and invoices
          don&apos;t change.
        </p>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {done && <p className="rounded-md border border-emerald-600/30 bg-emerald-500/10 p-2 text-sm text-emerald-700 dark:text-emerald-400" data-testid="move-credit-done">✔ {done} moved to this booking.</p>}
      </CardContent>
    </Card>
  );
}
