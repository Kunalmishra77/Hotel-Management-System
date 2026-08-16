"use client";
/** Org self-signup form (architecture v2 · SaaS). Creates the tenant + admin, then
 *  sends them to sign in. */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { startTrial } from "../actions";

export function StartForm() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [f, setF] = useState({ orgName: "", adminName: "", email: "", password: "" });

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  function submit() {
    setError(null);
    start(async () => {
      const res = await startTrial(f);
      if (!res.ok) return setError(res.error.message);
      setDone(true);
      setTimeout(() => router.push(`/sign-in?next=/dashboard`), 1400);
    });
  }

  if (done) {
    return (
      <div className="rounded-xl border bg-card p-8 text-center shadow-sm">
        <CheckCircle2 className="mx-auto size-8 text-emerald-600" aria-hidden="true" />
        <p className="mt-3 font-semibold">Your workspace is ready</p>
        <p className="mt-1 text-sm text-muted-foreground">Taking you to sign in…</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="orgName">Company / hotel group</Label>
        <Input id="orgName" value={f.orgName} onChange={set("orgName")} placeholder="e.g. Sunrise Hotels Pvt. Ltd." maxLength={120} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="adminName">Your name</Label>
        <Input id="adminName" value={f.adminName} onChange={set("adminName")} placeholder="Full name" maxLength={120} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="email">Work email</Label>
        <Input id="email" type="email" value={f.email} onChange={set("email")} placeholder="you@company.com" maxLength={200} autoComplete="email" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="password">Password</Label>
        <Input id="password" type="password" value={f.password} onChange={set("password")} placeholder="At least 10 characters" autoComplete="new-password" />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button onClick={submit} disabled={pending} size="lg" className="w-full">
        {pending ? "Creating your workspace…" : "Start free trial"}
      </Button>
      <p className="text-center text-xs text-muted-foreground">14-day free trial · no card required</p>
    </div>
  );
}
