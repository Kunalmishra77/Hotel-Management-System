"use client";

/**
 * Staff screen — 09 T-12/T-13 (AC-1/4/5/7). Masked list + add form + a quick
 * attendance action per staff. PII (Aadhaar/PAN/bank) is masked/never returned by
 * the query; this UI only renders what it's given. Mobile-first, ≥44px actions.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createStaff, recordAttendance, updateStaffSalary } from "../actions";
import type { StaffListItem } from "../queries";

const rupees = (p: number) => `₹${(p / 100).toLocaleString("en-IN")}`;
const toPaise = (r: number) => Math.round(r * 100);
const today = () => new Date().toISOString().slice(0, 10);

export function StaffScreen({
  propertyId,
  staff,
  canManage,
  canUpdateSalary,
}: {
  propertyId: string;
  staff: StaffListItem[];
  canManage: boolean;
  canUpdateSalary: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [mobile, setMobile] = useState("");
  const [department, setDepartment] = useState("Housekeeping");
  const [salary, setSalary] = useState(0);
  const [joinedOn, setJoinedOn] = useState(today());
  const [aadhaar, setAadhaar] = useState("");
  const [note, setNote] = useState<string | null>(null);

  const run = (fn: () => Promise<{ ok: boolean; error?: { message: string } }>, onOk?: () => void) => {
    setError(null); setNote(null);
    start(async () => {
      const res = await fn();
      if (res.ok) { onOk?.(); router.refresh(); }
      else setError(res.error?.message ?? "Something went wrong.");
    });
  };

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 p-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Staff</h1>
        {canManage ? (
          <Button asChild variant="outline" size="sm"><Link href="/staff/field" data-testid="field-staff-link"><MapPin className="size-4" /> Field staff</Link></Button>
        ) : null}
      </div>

      {canManage ? (
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Add staff</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5"><Label htmlFor="s-name">Name</Label><Input id="s-name" value={name} onChange={(e) => setName(e.target.value)} data-testid="staff-name" /></div>
            <div className="space-y-1.5"><Label htmlFor="s-mobile">Mobile</Label><Input id="s-mobile" inputMode="tel" value={mobile} onChange={(e) => setMobile(e.target.value)} data-testid="staff-mobile" /></div>
            <div className="space-y-1.5"><Label htmlFor="s-dept">Department</Label><Input id="s-dept" value={department} onChange={(e) => setDepartment(e.target.value)} data-testid="staff-dept" /></div>
            <div className="space-y-1.5"><Label htmlFor="s-sal">Salary/mo (₹)</Label><Input id="s-sal" type="number" inputMode="numeric" value={salary} onChange={(e) => setSalary(Number(e.target.value))} data-testid="staff-salary" /></div>
            <div className="space-y-1.5"><Label htmlFor="s-join">Joined on</Label><Input id="s-join" type="date" value={joinedOn} onChange={(e) => setJoinedOn(e.target.value)} /></div>
            <div className="space-y-1.5"><Label htmlFor="s-aad">Aadhaar</Label><Input id="s-aad" value={aadhaar} onChange={(e) => setAadhaar(e.target.value)} data-testid="staff-aadhaar" /></div>
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <Button size="lg" disabled={pending || !name || !mobile || salary <= 0}
            onClick={() => run(() => createStaff({ propertyId, name, mobile, department, monthlySalaryPaise: toPaise(salary), joinedOn, aadhaar: aadhaar || undefined }), () => { setName(""); setMobile(""); setSalary(0); setAadhaar(""); })}
            data-testid="staff-save">Add</Button>
        </CardContent>
      </Card>
      ) : null}

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Team</CardTitle></CardHeader>
        <CardContent>
          {note && <p className="mb-2 text-sm text-muted-foreground" data-testid="attendance-note">{note}</p>}
          {staff.length === 0 ? (
            <p className="text-sm text-muted-foreground">No staff yet.</p>
          ) : (
            <ul className="divide-y rounded-md border" data-testid="staff-list">
              {staff.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-2 p-3 text-sm" data-testid={`staff-${s.id}`}>
                  <div>
                    <p className="font-medium">{s.name} · {s.department}{s.isActive ? "" : " (inactive)"}</p>
                    <p className="text-xs text-muted-foreground">{s.maskedMobile} · {rupees(s.monthlySalaryPaise)} · {s.aadhaarMasked ?? "no ID"}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {s.isActive && (
                      <Button size="sm" variant="outline" disabled={pending}
                        onClick={() => run(() => recordAttendance({ staffId: s.id, day: today(), checkInAt: `${today()}T09:00:00+05:30`, checkOutAt: `${today()}T17:30:00+05:30` }), () => setNote(`Marked ${s.name} present today.`))}
                        data-testid={`present-${s.id}`}>Mark present</Button>
                    )}
                    {canUpdateSalary && s.isActive && (
                      <Button size="sm" variant="ghost" disabled={pending}
                        onClick={() => {
                          const raw = window.prompt(`New monthly salary for ${s.name} (₹):`, String(Math.round(s.monthlySalaryPaise / 100)));
                          if (raw === null) return;
                          const rupeesNum = Number(raw);
                          if (!Number.isFinite(rupeesNum) || rupeesNum <= 0) { setError("Enter a valid salary."); return; }
                          run(() => updateStaffSalary({ staffId: s.id, monthlySalaryPaise: toPaise(rupeesNum) }), () => setNote(`Updated ${s.name}'s salary.`));
                        }}
                        data-testid={`salary-${s.id}`}>Salary</Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
