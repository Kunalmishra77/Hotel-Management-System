"use client";

/**
 * Check-in wizard · Identity step (03 T6). Finalized front-desk workflow: capture
 * each ID as DOCUMENT IMAGES, not a typed number. The upload slots change with the
 * document type — Aadhaar takes a front + back, PAN/DL/Voter a single front,
 * Passport its photo page, Visa its page. A number is optional (never forced, and
 * never a full Aadhaar number by default). Images go to encrypted object storage;
 * the row keeps only an object key + checksum.
 */
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { BadgeCheck, ScanLine, Upload, X, IdCard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { addGuestId } from "@/features/guests/id-actions";
import type { CheckInIdSummary } from "../queries";

const ID_TYPES = [
  { value: "AADHAAR", label: "Aadhaar" },
  { value: "PASSPORT", label: "Passport" },
  { value: "PAN", label: "PAN" },
  { value: "DRIVING_LICENCE", label: "Driving licence" },
  { value: "VOTER_ID", label: "Voter ID" },
  { value: "VISA", label: "Visa" },
] as const;
const LABEL: Record<string, string> = Object.fromEntries(ID_TYPES.map((t) => [t.value, t.label]));

/** Which image slots each document type needs (front always; back only for Aadhaar). */
const DOC_SLOTS: Record<string, { front: string; back?: string }> = {
  AADHAAR: { front: "Aadhaar — front", back: "Aadhaar — back" },
  PASSPORT: { front: "Passport — photo page" },
  PAN: { front: "PAN — front" },
  DRIVING_LICENCE: { front: "Driving licence — front" },
  VOTER_ID: { front: "Voter ID — front" },
  VISA: { front: "Visa — page" },
};

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1] ?? "");
    reader.onerror = () => reject(new Error("Could not read the file."));
    reader.readAsDataURL(file);
  });
}

/** A single labelled upload tile with a thumbnail preview + remove. */
function UploadSlot({
  id, label, file, onPick,
}: {
  id: string;
  label: string;
  file: File | null;
  onPick: (f: File | null) => void;
}) {
  const preview = file ? URL.createObjectURL(file) : null;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs">{label}</Label>
      {file ? (
        <div className="flex items-center gap-3 rounded-lg border bg-muted/30 p-2">
          {preview && file.type.startsWith("image/") ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="" className="size-12 shrink-0 rounded object-cover" />
          ) : (
            <span className="grid size-12 shrink-0 place-items-center rounded bg-primary/10 text-primary"><IdCard className="size-5" /></span>
          )}
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{file.name}</span>
          <button type="button" onClick={() => onPick(null)} aria-label="Remove" className="rounded-md p-1.5 text-muted-foreground transition hover:bg-muted hover:text-destructive">
            <X className="size-4" />
          </button>
        </div>
      ) : (
        <label htmlFor={id} className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed bg-card px-3 py-4 text-sm text-muted-foreground transition hover:border-primary/40 hover:text-foreground">
          <Upload className="size-4" aria-hidden="true" /> Upload or take a photo
        </label>
      )}
      <input
        id={id}
        type="file"
        accept="image/*,application/pdf"
        capture="environment"
        className="hidden"
        onChange={(e) => onPick(e.target.files?.[0] ?? null)}
      />
    </div>
  );
}

export function IdentityStep({
  guestId,
  ids,
  onAdded,
}: {
  guestId: string;
  ids: CheckInIdSummary[];
  onAdded: (id: CheckInIdSummary) => void;
  /** Retained for compatibility; the finalized workflow captures document images. */
  canStoreAadhaarScan?: boolean;
}) {
  const [type, setType] = useState<string>("AADHAAR");
  const [value, setValue] = useState("");
  const [front, setFront] = useState<File | null>(null);
  const [back, setBack] = useState<File | null>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const slots = DOC_SLOTS[type] ?? { front: "Document image" };
  const reset = () => { setValue(""); setFront(null); setBack(null); };

  const submit = () => {
    if (!front && !value.trim()) {
      setError("Upload the document image (or enter a number).");
      return;
    }
    setError(null);
    start(async () => {
      let scanBase64: string | undefined;
      let scanContentType: string | undefined;
      let backScanBase64: string | undefined;
      let backScanContentType: string | undefined;
      try {
        if (front) { scanBase64 = await fileToBase64(front); scanContentType = front.type || "application/octet-stream"; }
        if (back) { backScanBase64 = await fileToBase64(back); backScanContentType = back.type || "application/octet-stream"; }
      } catch {
        setError("Could not read an image. Try again.");
        return;
      }
      const res = await addGuestId({
        guestId, type,
        value: value.trim() || undefined,
        scanBase64, scanContentType, backScanBase64, backScanContentType,
      });
      if (!res.ok) { setError(res.error.message); return; }
      onAdded({ id: res.data.id, type: res.data.type, maskedValue: res.data.maskedValue, hasScan: res.data.hasScan });
      setType("AADHAAR");
      reset();
      toast.success(`${LABEL[res.data.type] ?? "ID"} added`);
    });
  };

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-semibold">Identity documents</h3>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Upload the guest&apos;s ID. Aadhaar is required at check-in. Images are stored encrypted; the number is optional.
        </p>
      </div>

      {ids.length > 0 ? (
        <ul className="space-y-2" data-testid="captured-ids">
          {ids.map((id) => (
            <li key={id.id} className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">
              <span className="flex items-center gap-2">
                <BadgeCheck className="size-4 text-success" />
                <span className="font-medium">{LABEL[id.type] ?? id.type}</span>
                <span className="font-mono text-muted-foreground">{id.maskedValue ?? "Image on file"}</span>
              </span>
              {id.hasScan ? (
                <Badge variant="secondary" className="gap-1"><ScanLine className="size-3" /> Scan</Badge>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-lg border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">
          No documents captured yet.
        </p>
      )}

      <div className="space-y-4 rounded-lg border border-border p-3.5">
        <div className="space-y-1.5">
          <Label htmlFor="id-type">Document type</Label>
          <Select value={type} onValueChange={(v) => { setType(v); reset(); }}>
            <SelectTrigger id="id-type" data-testid="id-type"><SelectValue /></SelectTrigger>
            <SelectContent>
              {ID_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {/* Dynamic upload slots — front always, back only when the type needs it. */}
        <div className={slots.back ? "grid gap-3 sm:grid-cols-2" : ""}>
          <UploadSlot id="id-front" label={slots.front} file={front} onPick={setFront} />
          {slots.back ? <UploadSlot id="id-back" label={slots.back} file={back} onPick={setBack} /> : null}
        </div>

        {/* Number — optional, secondary */}
        <div className="space-y-1.5">
          <Label htmlFor="id-value" className="text-xs text-muted-foreground">ID number <span className="font-normal">(optional)</span></Label>
          <Input
            id="id-value"
            data-testid="id-value"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            inputMode={type === "AADHAAR" ? "numeric" : "text"}
            autoComplete="off"
            placeholder={type === "AADHAAR" ? "Optional — masked, last 4 kept" : "Optional"}
          />
        </div>

        {error ? <p role="alert" className="text-sm text-destructive" data-testid="id-error">{error}</p> : null}

        <Button type="button" onClick={submit} disabled={pending} className="w-full sm:w-auto" data-testid="add-id">
          {pending ? "Adding…" : "Add document"}
        </Button>
      </div>
    </div>
  );
}
