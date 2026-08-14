"use client";
/**
 * Guest self-service online check-in (Wave 2). Shown on the booking detail page
 * for a CONFIRMED, upcoming stay. The guest confirms their arrival window + any
 * special request and signs the digital registration card — the same signature →
 * encrypted-storage → RegistrationCard path as the front desk, done from home.
 * Reception then confirms in one tap at arrival.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, PenLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { SignaturePad } from "@/components/ui/signature-pad";
import { submitOnlineCheckIn } from "../checkin-actions";

export function OnlineCheckIn({
  reservationId,
  alreadyCheckedIn,
}: {
  reservationId: string;
  alreadyCheckedIn: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [signature, setSignature] = useState<string | null>(null);
  const [arrival, setArrival] = useState("");
  const [requests, setRequests] = useState("");

  if (alreadyCheckedIn) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-emerald-600/30 bg-emerald-600/5 px-3 py-2.5 text-sm text-emerald-700 dark:text-emerald-400">
        <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
        <span>Online check-in complete. Just show your ID at the desk to collect your key.</span>
      </div>
    );
  }

  function submit() {
    setError(null);
    if (!signature) {
      setError("Please sign to complete check-in.");
      return;
    }
    startTransition(async () => {
      const res = await submitOnlineCheckIn({
        reservationId,
        signatureBase64: signature,
        expectedArrival: arrival.trim() || undefined,
        specialRequests: requests.trim() || undefined,
      });
      if (!res.ok) {
        setError(res.error.message);
        return;
      }
      router.refresh();
    });
  }

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)} className="w-full sm:w-auto">
        <PenLine className="size-4" aria-hidden="true" /> Check in online
      </Button>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold">Check in online</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Sign your registration now to skip the paperwork at arrival.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="oci-arrival">Expected arrival time (optional)</Label>
        <Input
          id="oci-arrival"
          value={arrival}
          onChange={(e) => setArrival(e.target.value)}
          placeholder="e.g. around 6 PM"
          maxLength={40}
          autoComplete="off"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="oci-requests">Special requests (optional)</Label>
        <Textarea
          id="oci-requests"
          value={requests}
          onChange={(e) => setRequests(e.target.value)}
          placeholder="Early check-in, high floor, extra pillows…"
          maxLength={500}
          rows={3}
        />
      </div>

      <SignaturePad onChange={setSignature} label="Sign to confirm your details are correct" />

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex flex-wrap gap-2">
        <Button onClick={submit} disabled={pending}>
          {pending ? "Completing…" : "Complete check-in"}
        </Button>
        <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
          Not now
        </Button>
      </div>
    </div>
  );
}
