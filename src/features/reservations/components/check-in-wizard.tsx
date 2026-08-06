"use client";

/**
 * Guided check-in wizard (03 T6). Replaces the board's one-click check-in with a
 * mobile-first stepped flow: Verify the booking → capture Identity documents
 * (Aadhaar mandatory, MoM) → Confirm, which calls the existing `checkIn` action
 * (posts the advance + booking extras, flips the room, emits GuestCheckedIn so
 * the welcome message fires). Later slices add the registration card + signature,
 * payment collection, and key issue between Identity and Confirm.
 */
import { useMemo, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, ChevronLeft, FileSignature, IdCard, ListChecks, UserCheck, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDayMonth, formatINR } from "@/lib/utils";
import { checkIn } from "../lifecycle-actions";
import { IdentityStep } from "./check-in-identity-step";
import { RegistrationStep } from "./check-in-registration-step";
import { PaymentStep } from "./check-in-payment-step";
import type { CheckInContext, CheckInIdSummary } from "../queries";

const STEPS = [
  { key: "verify", label: "Verify", icon: ListChecks },
  { key: "identity", label: "Identity", icon: IdCard },
  { key: "registration", label: "Register", icon: FileSignature },
  { key: "payment", label: "Payment", icon: Wallet },
  { key: "confirm", label: "Confirm", icon: UserCheck },
] as const;
type StepKey = (typeof STEPS)[number]["key"];

const SETTLEMENT_LABEL: Record<string, string> = {
  PAY_AT_HOTEL: "Pay at hotel",
  ALREADY_PAID: "Already paid",
  UNPAID_ONLINE: "Awaiting online payment",
};

export function CheckInWizard({
  context,
  canStoreAadhaarScan,
}: {
  context: CheckInContext;
  canStoreAadhaarScan: boolean;
}) {
  const router = useRouter();
  const [step, setStep] = useState<StepKey>("verify");
  const [ids, setIds] = useState<CheckInIdSummary[]>(context.ids);
  const [registrationSaved, setRegistrationSaved] = useState(false);
  const [collectedPaise, setCollectedPaise] = useState(0);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const hasAadhaar = useMemo(() => ids.some((i) => i.type === "AADHAAR"), [ids]);
  const stepIndex = STEPS.findIndex((s) => s.key === step);

  const complete = () => {
    setError(null);
    start(async () => {
      const res = await checkIn({ reservationId: context.id });
      if (!res.ok) {
        setError(res.error?.message ?? "Check-in failed.");
        return;
      }
      toast.success(`${context.guestName} checked in`);
      router.push(`/bookings/${context.id}`);
      router.refresh();
    });
  };

  return (
    <div className="mx-auto w-full max-w-2xl">
      <Stepper current={stepIndex} />

      <Card className="mt-4">
        <CardContent className="p-4 sm:p-5">
          {step === "verify" ? (
            <VerifyStep context={context} />
          ) : step === "identity" ? (
            <IdentityStep
              guestId={context.guestId}
              ids={ids}
              onAdded={(id) => setIds((prev) => [...prev, id])}
              canStoreAadhaarScan={canStoreAadhaarScan}
            />
          ) : step === "registration" ? (
            <RegistrationStep
              context={{ ...context, ids }}
              saved={registrationSaved}
              onSaved={() => setRegistrationSaved(true)}
            />
          ) : step === "payment" ? (
            <PaymentStep
              context={context}
              collectedPaise={collectedPaise}
              onCollected={(amt) => setCollectedPaise((prev) => prev + amt)}
            />
          ) : (
            <ConfirmStep
              context={context}
              idCount={ids.length}
              registrationSaved={registrationSaved}
              collectedPaise={collectedPaise}
            />
          )}

          {step === "identity" && !hasAadhaar ? (
            <p className="mt-4 text-sm text-warning" data-testid="aadhaar-required">
              Capture the guest&apos;s Aadhaar to continue.
            </p>
          ) : null}

          {error ? (
            <p role="alert" className="mt-4 text-sm text-destructive" data-testid="checkin-error">
              {error}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <div className="mt-4 flex items-center justify-between gap-3">
        <Button
          variant="outline"
          onClick={() => setStep(STEPS[Math.max(0, stepIndex - 1)]!.key)}
          disabled={stepIndex === 0 || pending}
        >
          <ChevronLeft /> Back
        </Button>

        {step === "confirm" ? (
          <Button onClick={complete} disabled={pending} data-testid="complete-checkin">
            <Check /> {pending ? "Checking in…" : "Complete check-in"}
          </Button>
        ) : (
          <Button
            onClick={() => setStep(STEPS[stepIndex + 1]!.key)}
            disabled={(step === "identity" && !hasAadhaar) || (step === "registration" && !registrationSaved)}
            data-testid="wizard-continue"
          >
            Continue
          </Button>
        )}
      </div>
    </div>
  );
}

function Stepper({ current }: { current: number }) {
  return (
    <ol className="flex items-center gap-2" data-testid="wizard-steps">
      {STEPS.map((s, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={s.key} className="flex flex-1 items-center gap-2">
            <span
              className={`flex size-8 shrink-0 items-center justify-center rounded-full border text-sm ${
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : done
                    ? "border-success bg-success/10 text-success"
                    : "border-border text-muted-foreground"
              }`}
            >
              {done ? <Check className="size-4" /> : <s.icon className="size-4" />}
            </span>
            <span className={`text-sm font-medium ${active ? "text-foreground" : "text-muted-foreground"}`}>
              {s.label}
            </span>
            {i < STEPS.length - 1 ? <span className="hidden h-px flex-1 bg-border sm:block" /> : null}
          </li>
        );
      })}
    </ol>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-right text-sm font-medium">{children}</span>
    </div>
  );
}

function VerifyStep({ context }: { context: CheckInContext }) {
  return (
    <div className="space-y-1 divide-y divide-border/60">
      <div className="pb-2">
        <p className="text-base font-semibold">{context.guestName}</p>
        <p className="text-sm text-muted-foreground">
          <span className="font-mono">{context.code}</span>
          {context.guestMaskedMobile ? ` · ${context.guestMaskedMobile}` : ""}
        </p>
      </div>
      <Row label="Rooms">{context.roomNumbers.join(", ") || "Unallocated"}</Row>
      <Row label="Stay">
        {formatDayMonth(context.checkInDate)} → {formatDayMonth(context.checkOutDate)} · {context.nights} night(s)
      </Row>
      <Row label="Occupancy">
        {context.adults} adult(s){context.children > 0 ? `, ${context.children} child(ren)` : ""}
      </Row>
      <Row label="Payment">
        <Badge variant="secondary">{SETTLEMENT_LABEL[context.settlementIntent] ?? context.settlementIntent}</Badge>
      </Row>
      {context.balancePaise !== null ? (
        <Row label="Balance due">
          <span className={context.balancePaise > 0 ? "text-warning" : "text-success"}>
            {formatINR(context.balancePaise)}
          </span>
        </Row>
      ) : null}
    </div>
  );
}

function ConfirmStep({
  context,
  idCount,
  registrationSaved,
  collectedPaise,
}: {
  context: CheckInContext;
  idCount: number;
  registrationSaved: boolean;
  collectedPaise: number;
}) {
  return (
    <div className="space-y-1 divide-y divide-border/60">
      <div className="pb-2">
        <h3 className="text-sm font-semibold">Ready to check in</h3>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Confirm to move {context.guestName} in-house and open the folio.
        </p>
      </div>
      <Row label="Room(s)">{context.roomNumbers.join(", ") || "Unallocated"}</Row>
      <Row label="Documents">{idCount} captured</Row>
      <Row label="Registration">
        {registrationSaved ? (
          <span className="text-success">Signed</span>
        ) : (
          <span className="text-muted-foreground">Not signed</span>
        )}
      </Row>
      <Row label="Payment">{SETTLEMENT_LABEL[context.settlementIntent] ?? context.settlementIntent}</Row>
      {collectedPaise > 0 ? (
        <Row label="Collected">
          <span className="text-success">{formatINR(collectedPaise)}</span>
        </Row>
      ) : null}
    </div>
  );
}
