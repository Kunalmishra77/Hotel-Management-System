"use client";

/**
 * Reveal-PII sheet — 04 T-19 (FR-9, AC-8/AC-9).
 *
 * PII is masked everywhere by default. Revealing a field is a deliberate,
 * REASON-REQUIRED, audited act: the sheet forces a reason before it will call
 * `revealPii`, and the server re-checks both the permission AND the reason (the
 * button being visible is not authorization). The revealed value is shown once,
 * in memory — it is never written back into the page's data or the URL.
 */
import { useState, useTransition } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { revealPii } from "../pii-actions";

export function RevealSheet({
  guestId,
  field,
  label,
  onClose,
}: {
  guestId: string;
  field: "mobile" | "email" | "whatsapp";
  label: string;
  onClose: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [reason, setReason] = useState("");
  const [value, setValue] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reveal = () => {
    setError(null);
    startTransition(async () => {
      const result = await revealPii({ guestId, field, reason });
      if (result.ok) setValue(result.data.value);
      else setError(result.error.message);
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/40" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Reveal ${label}`}
        data-testid="reveal-sheet"
        className="relative w-full rounded-t-xl border bg-background p-4 shadow-lg pb-[calc(env(safe-area-inset-bottom)+1rem)] sm:max-w-sm sm:rounded-xl sm:pb-4"
      >
        <div className="mb-3 flex items-start justify-between gap-2">
          <h2 className="text-lg font-semibold">Reveal {label}</h2>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
            <X className="size-4" />
          </Button>
        </div>

        {value === null ? (
          <>
            <p className="text-sm text-muted-foreground">
              This access is logged against your name. Enter why you need it.
            </p>
            <div className="mt-3 space-y-1.5">
              <Label htmlFor="reveal-reason">Reason</Label>
              <Input
                id="reveal-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Returning a lost item"
                data-testid="reveal-reason"
                autoFocus
              />
            </div>
            {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
            <Button
              block
              size="lg"
              className="mt-4"
              disabled={pending || reason.trim().length === 0}
              onClick={reveal}
              data-testid="reveal-confirm"
            >
              {pending ? "Revealing…" : "Reveal"}
            </Button>
          </>
        ) : (
          <div className="space-y-3">
            <p className="rounded-md border bg-muted/40 p-3 font-mono text-lg" data-testid="revealed-value">
              {value}
            </p>
            <Button block variant="outline" size="lg" onClick={onClose}>Done</Button>
          </div>
        )}
      </div>
    </div>
  );
}
