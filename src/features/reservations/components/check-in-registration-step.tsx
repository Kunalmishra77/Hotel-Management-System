"use client";

/**
 * Check-in wizard · Registration step (03 T6). The guest signs a digital
 * registration card (name / room / dates / IDs on file) and reception records the
 * room key/card handed over. `saveRegistrationCard` persists it — the signature
 * goes to encrypted object storage, the row keeps only the reference. A signature
 * is required to save, so the card is genuinely a signed record.
 */
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SignaturePad } from "@/components/ui/signature-pad";
import { formatDayMonth } from "@/lib/utils";
import { saveRegistrationCard } from "../checkin-actions";
import type { CheckInContext } from "../queries";

export function RegistrationStep({
  context,
  saved,
  onSaved,
}: {
  context: CheckInContext;
  saved: boolean;
  onSaved: () => void;
}) {
  const [signature, setSignature] = useState<string | null>(null);
  const [keyCardRef, setKeyCardRef] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    if (!signature) {
      setError("Ask the guest to sign before saving.");
      return;
    }
    setError(null);
    start(async () => {
      const res = await saveRegistrationCard({
        reservationId: context.id,
        signatureBase64: signature,
        keyCardRef: keyCardRef.trim() || undefined,
      });
      if (!res.ok) {
        setError(res.error?.message ?? "Could not save the registration card.");
        return;
      }
      onSaved();
      toast.success("Registration card saved");
    });
  };

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-semibold">Registration card</h3>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Confirm the details, capture the guest&apos;s signature, and record the room key.
        </p>
      </div>

      <dl className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
        <div className="flex justify-between py-0.5">
          <dt className="text-muted-foreground">Guest</dt>
          <dd className="font-medium">{context.guestName}</dd>
        </div>
        <div className="flex justify-between py-0.5">
          <dt className="text-muted-foreground">Room · stay</dt>
          <dd className="text-right font-medium">
            {context.roomNumbers.join(", ") || "—"} · {formatDayMonth(context.checkInDate)}→
            {formatDayMonth(context.checkOutDate)} · {context.nights}n
          </dd>
        </div>
        <div className="flex justify-between py-0.5">
          <dt className="text-muted-foreground">Documents</dt>
          <dd className="font-medium">{context.ids.length} on file</dd>
        </div>
      </dl>

      <SignaturePad onChange={setSignature} label="Guest signature" />

      <div className="space-y-1.5">
        <Label htmlFor="key-card">Room key / access card</Label>
        <Input
          id="key-card"
          data-testid="key-card-ref"
          value={keyCardRef}
          onChange={(e) => setKeyCardRef(e.target.value)}
          placeholder="e.g. Key #104 / Card A-12"
          autoComplete="off"
        />
      </div>

      {error ? (
        <p role="alert" className="text-sm text-destructive" data-testid="registration-error">
          {error}
        </p>
      ) : null}

      <Button type="button" onClick={save} disabled={pending} className="w-full sm:w-auto" data-testid="save-registration">
        {saved ? <Check /> : null}
        {pending ? "Saving…" : saved ? "Saved — re-save" : "Save registration"}
      </Button>
      {saved ? (
        <p className="text-sm text-success" data-testid="registration-saved">
          Registration card saved. Continue to finish check-in.
        </p>
      ) : null}
    </div>
  );
}
