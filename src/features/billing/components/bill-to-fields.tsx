"use client";

/**
 * Bill-to fields shared by "Generate / Correct bill" and the manual bill
 * (specs/06 FR-MB-2). A company (GST) bill needs the company's GSTIN and address
 * (Rule 46); the state fills itself from the GSTIN's first two digits, and the
 * guest who stayed can be printed under the company.
 */
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GSTIN_RE, normalizeGstin, stateFromGstin } from "@/lib/gstin";
import { INDIAN_STATES } from "@/lib/constants/indian-states";

export type BillToValue = {
  customerName: string;
  customerGstin: string;
  customerAddress: string;
  customerState: string;
  customerPhone: string;
  guestName: string;
  company: boolean;
};

export const emptyBillTo = (name = ""): BillToValue => ({
  customerName: name, customerGstin: "", customerAddress: "", customerState: "", customerPhone: "", guestName: "", company: false,
});

/** Problems that block submitting, or null. */
export function billToProblem(v: BillToValue): string | null {
  if (!v.customerName.trim()) return "Enter the name on the bill.";
  const g = normalizeGstin(v.customerGstin);
  if (g && !GSTIN_RE.test(g)) return "A GSTIN is 15 characters, e.g. 07AAHCT9474D1Z0.";
  if (v.company && g && !v.customerAddress.trim()) return "A company GST bill needs the company's address.";
  return null;
}

/** The action payload (blank fields left out). */
export function billToPayload(v: BillToValue) {
  const g = normalizeGstin(v.customerGstin);
  return {
    customerName: v.customerName.trim(),
    ...(g ? { customerGstin: g } : {}),
    ...(v.company && v.customerAddress.trim() ? { customerAddress: v.customerAddress.trim() } : {}),
    ...(v.company && v.customerState.trim() ? { customerState: v.customerState.trim() } : {}),
    ...(v.customerPhone.trim() ? { customerPhone: v.customerPhone.trim() } : {}),
    ...(v.company && v.guestName.trim() ? { guestName: v.guestName.trim() } : {}),
  };
}

export function BillToFields({ value, onChange, idPrefix = "bt" }: { value: BillToValue; onChange: (v: BillToValue) => void; idPrefix?: string }) {
  const set = (patch: Partial<BillToValue>) => onChange({ ...value, ...patch });
  const g = normalizeGstin(value.customerGstin);
  const gstinBad = g !== "" && !GSTIN_RE.test(g);
  const id = (k: string) => `${idPrefix}-${k}`;
  return (
    <div className="space-y-3">
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input type="checkbox" className="size-4" checked={value.company} onChange={(e) => set({ company: e.target.checked })} data-testid="bill-to-company" />
        Company / GST bill (bill in the company&apos;s name)
      </label>
      <div className="space-y-1.5">
        <Label htmlFor={id("name")}>{value.company ? "Company name" : "Name on the bill"}</Label>
        <Input id={id("name")} value={value.customerName} onChange={(e) => set({ customerName: e.target.value })} placeholder={value.company ? "e.g. NuMed Systems Pvt Ltd" : "Guest name"} data-testid="bill-to-name" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={id("gstin")}>GSTIN {value.company ? "" : "(company bills only)"}</Label>
          <Input
            id={id("gstin")} value={value.customerGstin} autoCapitalize="characters" placeholder="e.g. 07AAHCT9474D1Z0" data-testid="bill-to-gstin"
            onChange={(e) => {
              const next = e.target.value;
              const st = stateFromGstin(next);
              set({ customerGstin: next, ...(st ? { customerState: st, company: true } : {}) });
            }}
          />
          {gstinBad ? <p role="alert" className="text-xs text-destructive">A GSTIN is 15 characters, e.g. 07AAHCT9474D1Z0.</p> : null}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={id("phone")}>Phone (optional)</Label>
          <Input id={id("phone")} type="tel" inputMode="tel" value={value.customerPhone} onChange={(e) => set({ customerPhone: e.target.value })} data-testid="bill-to-phone" />
        </div>
      </div>
      {value.company ? (
        <>
          <div className="space-y-1.5">
            <Label htmlFor={id("address")}>Company address</Label>
            <Input id={id("address")} value={value.customerAddress} onChange={(e) => set({ customerAddress: e.target.value })} placeholder="Office address, city, PIN" data-testid="bill-to-address" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={id("state")}>State</Label>
              <Input id={id("state")} list={id("states")} value={value.customerState} onChange={(e) => set({ customerState: e.target.value })} data-testid="bill-to-state" />
              <datalist id={id("states")}>{INDIAN_STATES.map((s) => <option key={s} value={s} />)}</datalist>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={id("guest")}>Guest who stayed (optional)</Label>
              <Input id={id("guest")} value={value.guestName} onChange={(e) => set({ guestName: e.target.value })} placeholder="Printed as “Guest: …”" data-testid="bill-to-guest" />
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
