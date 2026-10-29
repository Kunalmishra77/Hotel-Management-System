"use client";

/**
 * Pending guest information (client req #6) as a fill-in card: it asks ONLY for
 * what is still missing on the guest (computed by domain/guest-checklist), keeps
 * everything already captured at booking / check-in, and saves just the fields
 * typed here. It replaced a link to the full guest edit form, which made reception
 * wade through ~20 fields to add one email — and couldn't take the ID scan, the
 * item most often missing.
 */
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ClipboardCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { updateGuest } from "@/features/guests/actions";
import { addGuestId } from "@/features/guests/id-actions";
import type { ChecklistItem } from "../domain/guest-checklist";

const ID_TYPES = [
  { value: "AADHAAR", label: "Aadhaar" }, { value: "PASSPORT", label: "Passport" }, { value: "DRIVING_LICENCE", label: "Driving licence" },
  { value: "VOTER_ID", label: "Voter ID" }, { value: "PAN", label: "PAN" }, { value: "VISA", label: "Visa" }, { value: "OTHER", label: "Other ID" },
];

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve((r.result as string).split(",")[1] ?? "");
    r.onerror = () => reject(new Error("Could not read the file."));
    r.readAsDataURL(file);
  });
}

export function PendingInfoCard({
  guestId,
  reservationId,
  items,
  stayStatus,
  canEdit,
  address,
  existingIdType,
}: {
  guestId: string;
  reservationId: string;
  items: ChecklistItem[];
  stayStatus: string;
  canEdit: boolean;
  /** What's already on file — pre-filled so it is never typed twice. */
  address: { addressLine: string | null; city: string | null; state: string | null; pincode: string | null; country: string | null };
  /** Type of the ID already on file (for "scan missing"), so the scan attaches to the same document type. */
  existingIdType: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const has = (k: string) => items.some((i) => i.key === k);

  const [mobile, setMobile] = useState("");
  const [email, setEmail] = useState("");
  const [gstin, setGstin] = useState("");
  const [addr, setAddr] = useState({ addressLine: address.addressLine ?? "", city: address.city ?? "", state: address.state ?? "", pincode: address.pincode ?? "", country: address.country ?? "" });
  const [idType, setIdType] = useState(existingIdType ?? "AADHAAR");
  const [front, setFront] = useState<File | null>(null);
  const [back, setBack] = useState<File | null>(null);

  const needsId = has("id") || has("id-scan");
  const fillable = items.filter((i) => i.key !== "balance");

  function save() {
    setError(null);
    setDone(false);
    start(async () => {
      // Only what was typed here goes out — empty fields mean "not collected yet".
      const patch: Record<string, string> = {};
      if (has("mobile") && mobile.trim()) patch.mobile = mobile.trim();
      if (has("email") && email.trim()) patch.email = email.trim();
      if (has("gstin") && gstin.trim()) patch.gstNumber = gstin.trim().toUpperCase();
      if (has("address")) {
        for (const [k, v] of Object.entries(addr)) if (v.trim() && v.trim() !== (address[k as keyof typeof address] ?? "")) patch[k] = v.trim();
      }
      const wantsId = needsId && front;
      if (Object.keys(patch).length === 0 && !wantsId) { setError("Fill at least one of the missing details."); return; }

      if (Object.keys(patch).length > 0) {
        const res = await updateGuest({ id: guestId, ...patch });
        if (!res.ok) { setError(res.error.message); return; }
      }
      if (wantsId && front) {
        const res = await addGuestId({
          guestId, type: idType,
          scanBase64: await toBase64(front), scanContentType: front.type || "image/jpeg",
          ...(back ? { backScanBase64: await toBase64(back), backScanContentType: back.type || "image/jpeg" } : {}),
        });
        if (!res.ok) { setError(res.error.message); return; }
      }
      setDone(true);
      setMobile(""); setEmail(""); setGstin(""); setFront(null); setBack(null);
      router.refresh(); // the checklist recomputes — collected items disappear
    });
  }

  return (
    <Card className="border-warning/40 bg-warning/5" data-testid="pending-info">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base [&_svg]:size-4 [&_svg]:text-warning">
          <ClipboardCheck /> Pending information
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          Only what&apos;s still missing{stayStatus === "IN_HOUSE" ? " — collect before checkout" : " — collect at check-in"}. Everything already captured is kept.
        </p>

        {!canEdit ? (
          <ul className="space-y-1.5">
            {items.map((item) => (
              <li key={item.key} className="flex items-center gap-2">
                <span aria-hidden="true" className={item.required ? "text-warning" : "text-muted-foreground"}>●</span>
                <span>{item.label}</span>
                {item.required ? <Badge variant="warning" className="ml-1">Required</Badge> : <span className="text-xs text-muted-foreground">optional</span>}
              </li>
            ))}
          </ul>
        ) : (
          <>
            {has("mobile") && (
              <Field label="Contact number" required>
                <Input type="tel" inputMode="tel" maxLength={15} value={mobile} onChange={(e) => setMobile(e.target.value)} placeholder="10-digit mobile" data-testid="pending-mobile" />
              </Field>
            )}
            {has("email") && (
              <Field label="Email (for the bill)">
                <Input type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" data-testid="pending-email" />
              </Field>
            )}
            {has("gstin") && (
              <Field label="Company GSTIN">
                <Input value={gstin} onChange={(e) => setGstin(e.target.value)} placeholder="15-character GSTIN" data-testid="pending-gstin" />
              </Field>
            )}
            {has("address") && (
              <div className="space-y-2">
                <Field label="Billing address">
                  <Input value={addr.addressLine} onChange={(e) => setAddr({ ...addr, addressLine: e.target.value })} placeholder="House / street / area" data-testid="pending-address" />
                </Field>
                {/* City / state / PIN already on file are pre-filled, not asked again. */}
                <div className="grid grid-cols-2 gap-2">
                  {!address.city && <Input value={addr.city} onChange={(e) => setAddr({ ...addr, city: e.target.value })} placeholder="City" aria-label="City" />}
                  {!address.state && <Input value={addr.state} onChange={(e) => setAddr({ ...addr, state: e.target.value })} placeholder="State" aria-label="State" />}
                  {!address.pincode && <Input inputMode="numeric" value={addr.pincode} onChange={(e) => setAddr({ ...addr, pincode: e.target.value })} placeholder="PIN code" aria-label="PIN code" />}
                </div>
              </div>
            )}
            {needsId && (
              <div className="space-y-2 rounded-md border bg-background p-2.5">
                <p className="font-medium">{has("id") ? "Photo ID" : "Scan of the ID on file"}</p>
                <select value={idType} onChange={(e) => setIdType(e.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm" aria-label="ID type" data-testid="pending-id-type">
                  {ID_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
                <Field label={idType === "AADHAAR" ? "Front" : "Document image"}>
                  <Input type="file" accept="image/*,application/pdf" capture="environment" onChange={(e) => setFront(e.target.files?.[0] ?? null)} data-testid="pending-id-front" />
                </Field>
                {idType === "AADHAAR" && (
                  <Field label="Back">
                    <Input type="file" accept="image/*,application/pdf" capture="environment" onChange={(e) => setBack(e.target.files?.[0] ?? null)} data-testid="pending-id-back" />
                  </Field>
                )}
              </div>
            )}
            {has("balance") && (
              <div className="flex items-center justify-between gap-2 rounded-md border bg-background p-2.5">
                <span>Outstanding balance to settle</span>
                <Button asChild size="sm" variant="outline"><Link href={`/bookings/${reservationId}/folio`}>Take payment</Link></Button>
              </div>
            )}

            {error && <p role="alert" className="text-destructive">{error}</p>}
            {done && <p className="text-emerald-700 dark:text-emerald-400" data-testid="pending-saved">✔ Saved</p>}
            {fillable.length > 0 && (
              <Button className="w-full" disabled={pending} onClick={save} data-testid="pending-save">
                {pending ? "Saving…" : "Save missing details"}
              </Button>
            )}
            <Link href={`/guests/${guestId}/edit`} className="block text-center text-xs text-muted-foreground underline-offset-4 hover:underline">
              Edit the full guest profile instead
            </Link>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}{required ? <span className="text-destructive"> *</span> : null}</Label>
      {children}
    </div>
  );
}
