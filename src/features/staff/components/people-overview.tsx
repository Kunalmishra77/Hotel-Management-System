"use client";

/**
 * People overview (Phase-3 ⑧) — the all-hotels view of the merged Staff + Payroll
 * module. One card per property: active headcount, present-today, committed monthly
 * salary, and the latest payroll run's state. Clicking a card scopes the app to that
 * property and re-renders in context (its Staff / Attendance / Payroll tabs open).
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Users, UserCheck, Wallet, ArrowRight, ReceiptText } from "lucide-react";
import { formatINR } from "@/lib/utils";
import { switchProperty } from "@/features/platform/actions";

export type PersonPropertyCard = {
  propertyId: string;
  propertyName: string;
  headcount: number;
  presentToday: number;
  monthlySalaryPaise: number;
  payrollMonth: string | null;
  payrollStatus: string | null;
  payrollNetPaise: number | null;
};

const RUN_TONE: Record<string, string> = {
  FINALIZED: "bg-success/10 text-success",
  PAID: "bg-success/10 text-success",
  DRAFT: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  GENERATED: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
};

const fmtMonth = (m: string): string => {
  const [y, mm] = m.split("-").map(Number);
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${MON[(mm ?? 1) - 1] ?? ""} ${y ?? ""}`.trim();
};

export function PeopleOverview({ cards }: { cards: PersonPropertyCard[] }) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const pick = (id: string) => {
    setError(null);
    setPendingId(id);
    start(async () => {
      const res = await switchProperty({ propertyId: id });
      if (res.ok) router.refresh();
      else { setError(res.error.message); setPendingId(null); }
    });
  };

  const totalHead = cards.reduce((n, c) => n + c.headcount, 0);
  const totalSalary = cards.reduce((n, c) => n + c.monthlySalaryPaise, 0);
  const totalPresent = cards.reduce((n, c) => n + c.presentToday, 0);

  return (
    <div>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Tile icon={<Users />} label="Total staff" value={String(totalHead)} />
        <Tile icon={<UserCheck />} label="Present today" value={String(totalPresent)} />
        <Tile icon={<Wallet />} label="Monthly salary cost" value={formatINR(totalSalary)} />
      </div>

      <div className="mb-3">
        <h2 className="text-lg font-semibold tracking-tight">Team by property</h2>
        <p className="text-sm text-muted-foreground">Pick a property to manage its staff, attendance and payroll. Switch anytime from the selector at the top.</p>
      </div>
      {error && <p role="alert" className="mb-3 text-sm text-destructive">{error}</p>}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((c) => {
          const busy = pendingId === c.propertyId;
          return (
            <button
              key={c.propertyId}
              type="button"
              onClick={() => pick(c.propertyId)}
              disabled={pendingId !== null}
              data-testid={`people-property-${c.propertyId}`}
              className="group flex flex-col gap-3 rounded-2xl border bg-card p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
            >
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-sm font-bold text-primary">
                  {c.propertyName.replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase()}
                </div>
                <p className="font-semibold leading-tight">{c.propertyName}</p>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                <Stat label="Staff" value={String(c.headcount)} />
                <Stat label="Present" value={String(c.presentToday)} tone="good" />
                <Stat label="Salary/mo" value={formatINR(c.monthlySalaryPaise)} />
              </div>
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="inline-flex items-center gap-1 text-muted-foreground"><ReceiptText className="size-3.5" /> Payroll</span>
                {c.payrollStatus ? (
                  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ${RUN_TONE[c.payrollStatus] ?? "bg-muted text-muted-foreground"}`}>
                    {fmtMonth(c.payrollMonth ?? "")} · {c.payrollStatus}
                  </span>
                ) : (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground">No run yet</span>
                )}
              </div>
              <span className="mt-auto inline-flex items-center gap-1 text-sm font-medium text-primary">
                {busy ? "Opening…" : <>Manage team <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" /></>}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Tile({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-card p-3 shadow-sm">
      <div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground [&_svg]:size-3.5">{icon}{label}</div>
      <p className="mt-1 text-lg font-semibold tabular">{value}</p>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "good" }) {
  return (
    <div className="rounded-lg border bg-muted/30 py-2">
      <div className={`text-sm font-semibold tabular ${tone === "good" ? "text-success" : "text-foreground"}`}>{value}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}
