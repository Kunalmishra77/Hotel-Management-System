"use client";

/**
 * Guest profile — 04 T-19 (FR-6/8/9, AC-7/AC-8).
 *
 * Everything is MASKED by default. A user with `guest:view-pii` gets a "Reveal"
 * affordance per contact field that opens the reason-gated sheet; without it,
 * there is no affordance and the server would refuse anyway. Government IDs are
 * shown masked (Aadhaar as last-4, AC-5) and can be added inline.
 */
import { useEffect, useState } from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RevealSheet } from "./reveal-sheet";
import { addGuestIdFormAction, type AddIdFormState } from "../form-actions";
import type { GuestProfile as GuestProfileData } from "../queries";
import type { GuestTierInfo } from "@/features/guest-history/domain/tier";

const TIER_VARIANT: Record<string, "brass" | "secondary" | "outline"> = {
  VIP: "brass",
  REPEAT: "secondary",
  NEW: "outline",
};

type RevealTarget = { field: "mobile" | "email" | "whatsapp"; label: string };

const ID_TYPES = ["AADHAAR", "PASSPORT", "DRIVING_LICENCE", "VOTER_ID", "PAN", "OTHER"] as const;

export function GuestProfile({
  guest,
  canRevealPii,
  tier,
}: {
  guest: GuestProfileData;
  canRevealPii: boolean;
  tier: GuestTierInfo;
}) {
  const [reveal, setReveal] = useState<RevealTarget | null>(null);

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold" data-testid="guest-name">{guest.fullName}</h1>
          {guest.companyName && (
            <p className="text-sm text-muted-foreground">{guest.companyName}</p>
          )}
          <div className="mt-1.5 flex flex-wrap gap-1.5" data-testid="guest-tags">
            <Badge variant={TIER_VARIANT[tier.tier] ?? "outline"}>{tier.label}</Badge>
            {guest.companyName && <Badge variant="secondary">Corporate</Badge>}
          </div>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/guests">Back</Link>
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Contact</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <ContactRow label="Mobile" value={guest.maskedMobile} canReveal={canRevealPii}
            onReveal={() => setReveal({ field: "mobile", label: "mobile" })} testid="mobile" />
          <ContactRow label="Email" value={guest.maskedEmail} canReveal={canRevealPii && !!guest.maskedEmail}
            onReveal={() => setReveal({ field: "email", label: "email" })} testid="email" />
          <Detail label="City" value={guest.city} />
          <Detail label="State" value={guest.state} />
          {guest.gstNumber && <Detail label="GSTIN" value={guest.gstNumber} />}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Identity documents</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {guest.ids.length === 0 ? (
            <p className="text-sm text-muted-foreground">No documents on file.</p>
          ) : (
            <ul className="divide-y rounded-md border" data-testid="guest-ids">
              {guest.ids.map((id) => (
                <li key={id.id} className="flex items-center justify-between p-3 text-sm">
                  <span>{ID_LABEL[id.type] ?? id.type}</span>
                  <span className="font-mono text-muted-foreground" data-testid="masked-id">
                    {id.maskedValue}{id.hasScan ? " · scan" : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <AddIdForm guestId={guest.id} />
        </CardContent>
      </Card>

      {reveal && (
        <RevealSheet
          guestId={guest.id}
          field={reveal.field}
          label={reveal.label}
          onClose={() => setReveal(null)}
        />
      )}
    </div>
  );
}

const ID_LABEL: Record<string, string> = {
  AADHAAR: "Aadhaar",
  PASSPORT: "Passport",
  DRIVING_LICENCE: "Driving licence",
  VOTER_ID: "Voter ID",
  PAN: "PAN",
  OTHER: "Other",
};

function ContactRow({
  label,
  value,
  canReveal,
  onReveal,
  testid,
}: {
  label: string;
  value: string | null;
  canReveal: boolean;
  onReveal: () => void;
  testid: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="font-mono" data-testid={`masked-${testid}`}>{value ?? "—"}</p>
      </div>
      {canReveal && value && (
        <Button variant="outline" size="sm" onClick={onReveal} data-testid={`reveal-${testid}`}>
          Reveal
        </Button>
      )}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p>{value}</p>
    </div>
  );
}

const ADD_INITIAL: AddIdFormState = { status: "idle" };

function AddIdForm({ guestId }: { guestId: string }) {
  const router = useRouter();
  const [state, submit, pending] = useActionState(addGuestIdFormAction, ADD_INITIAL);

  // A new document changes the masked list — pull the fresh server render.
  useEffect(() => {
    if (state.status === "added") router.refresh();
  }, [state, router]);

  return (
    <form action={submit} className="flex flex-col gap-2 border-t pt-3 sm:flex-row sm:items-end"
      data-testid="add-id-form">
      <input type="hidden" name="guestId" value={guestId} />
      <div className="space-y-1.5">
        <Label htmlFor="id-type">Type</Label>
        <select id="id-type" name="type"
          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm sm:w-40">
          {ID_TYPES.map((t) => <option key={t} value={t}>{ID_LABEL[t]}</option>)}
        </select>
      </div>
      <div className="flex-1 space-y-1.5">
        <Label htmlFor="id-value">Number</Label>
        <Input id="id-value" name="value" placeholder="Document number" data-testid="add-id-value" />
      </div>
      <Button type="submit" size="lg" disabled={pending} data-testid="add-id-submit">
        {pending ? "Adding…" : "Add"}
      </Button>
      {state.status === "error" && (
        <p role="alert" className="text-sm text-destructive sm:sr-only">{state.message}</p>
      )}
    </form>
  );
}
