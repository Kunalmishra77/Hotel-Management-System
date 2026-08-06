"use client";

/**
 * Check-in wizard · Identity step (03 T6). Aadhaar is MANDATORY at check-in
 * (MoM); PAN / Passport / DL / Voter / Visa are optional. Capture reuses 04's
 * `addGuestId` — the number is stored MASKED, encrypted, access-logged; a scan
 * (camera or file) goes to encrypted object storage. Compliance: an AADHAAR
 * SCAN is only offered when `COMPLIANCE_STORE_FULL_AADHAAR` is on — otherwise we
 * take the masked number alone (never a hard error). A passport captured here
 * feeds T7's FRRO / C-Form.
 */
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { BadgeCheck, ScanLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
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

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1] ?? "");
    reader.onerror = () => reject(new Error("Could not read the file."));
    reader.readAsDataURL(file);
  });
}

export function IdentityStep({
  guestId,
  ids,
  onAdded,
  canStoreAadhaarScan,
}: {
  guestId: string;
  ids: CheckInIdSummary[];
  onAdded: (id: CheckInIdSummary) => void;
  canStoreAadhaarScan: boolean;
}) {
  const [type, setType] = useState<string>("AADHAAR");
  const [value, setValue] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const scanAllowed = type !== "AADHAAR" || canStoreAadhaarScan;

  const submit = () => {
    if (!value.trim()) {
      setError("Enter the ID number.");
      return;
    }
    setError(null);
    start(async () => {
      let scan: { scanBase64: string; scanContentType: string } | undefined;
      try {
        if (file && scanAllowed) {
          scan = { scanBase64: await fileToBase64(file), scanContentType: file.type || "application/octet-stream" };
        }
      } catch {
        setError("Could not read the scan file. Try again.");
        return;
      }
      const res = await addGuestId({ guestId, type, value: value.trim(), ...scan });
      if (!res.ok) {
        setError(res.error.message);
        return;
      }
      onAdded({ id: res.data.id, type: res.data.type, maskedValue: res.data.maskedValue, hasScan: res.data.hasScan });
      setType("AADHAAR");
      setValue("");
      setFile(null);
      toast.success(`${LABEL[res.data.type] ?? "ID"} added`);
    });
  };

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-semibold">Identity documents</h3>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Aadhaar is required to check in. Numbers are stored masked and encrypted.
        </p>
      </div>

      {ids.length > 0 ? (
        <ul className="space-y-2" data-testid="captured-ids">
          {ids.map((id) => (
            <li
              key={id.id}
              className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm"
            >
              <span className="flex items-center gap-2">
                <BadgeCheck className="size-4 text-success" />
                <span className="font-medium">{LABEL[id.type] ?? id.type}</span>
                <span className="font-mono text-muted-foreground">{id.maskedValue}</span>
              </span>
              {id.hasScan ? (
                <Badge variant="secondary" className="gap-1">
                  <ScanLine className="size-3" /> Scan
                </Badge>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-lg border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">
          No documents captured yet.
        </p>
      )}

      <div className="space-y-3 rounded-lg border border-border p-3.5">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="id-type">Document type</Label>
            <Select value={type} onValueChange={(v) => { setType(v); setFile(null); }}>
              <SelectTrigger id="id-type" data-testid="id-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ID_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="id-value">ID number</Label>
            <Input
              id="id-value"
              data-testid="id-value"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              inputMode={type === "AADHAAR" ? "numeric" : "text"}
              autoComplete="off"
              placeholder={type === "AADHAAR" ? "1234 5678 9012" : "ID number"}
            />
          </div>
        </div>

        {scanAllowed ? (
          <div className="space-y-1.5">
            <Label htmlFor="id-scan">Scan or photo (optional)</Label>
            <Input
              id="id-scan"
              data-testid="id-scan"
              type="file"
              accept="image/*,application/pdf"
              capture="environment"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Aadhaar scans are disabled by policy — the masked number is stored.
          </p>
        )}

        {error ? (
          <p role="alert" className="text-sm text-destructive" data-testid="id-error">
            {error}
          </p>
        ) : null}

        <Button type="button" onClick={submit} disabled={pending} className="w-full sm:w-auto" data-testid="add-id">
          {pending ? "Adding…" : "Add document"}
        </Button>
      </div>
    </div>
  );
}
