import type { Metadata } from "next";
import { Check, Sparkles, Building2, BadgeCheck } from "lucide-react";
import { requirePermission } from "@/lib/auth/guard";
import { getSubscription } from "@/features/subscription/queries";
import { PLANS, ADDONS, PLAN_BY_ID, PLAN_STATUS_LABEL } from "@/features/subscription/plans";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Subscription" };

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;
const day = (d: Date) => new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

/**
 * Super Admin · Subscription & licensing (architecture v2 · SaaS). The org's plan,
 * effective modules, and the tier ladder. `settings:manage`.
 */
export default async function SubscriptionPage() {
  const user = await requirePermission("settings:manage");
  const sub = await getSubscription(user);
  const current = sub ? PLAN_BY_ID[sub.plan] : null;

  return (
    <div className="mx-auto w-full max-w-4xl px-1 py-1">
      <PageHeader title="Subscription & licensing" description="Your Woodpecker plan, modules, and billing." />

      {sub && current && (
        <Card className="mt-2 border-primary/30">
          <CardContent className="flex flex-col gap-4 py-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-primary">
                <BadgeCheck className="size-3.5" aria-hidden="true" /> Current plan
              </p>
              <p className="mt-1 text-2xl font-semibold">{current.name}</p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {PLAN_STATUS_LABEL[sub.planStatus] ?? sub.planStatus}
                {sub.planRenewsAt ? ` · renews ${day(sub.planRenewsAt)}` : ""}
              </p>
            </div>
            <div className="text-sm text-muted-foreground">
              <p className="inline-flex items-center gap-1.5"><Building2 className="size-4" aria-hidden="true" /> {sub.propertyCount} propert{sub.propertyCount === 1 ? "y" : "ies"}</p>
              <p className="mt-1 font-semibold text-foreground">{inr(current.pricePerPropertyMonth * sub.propertyCount)}/mo</p>
              <p className="text-xs">{inr(current.pricePerPropertyMonth)} × {sub.propertyCount} · GST extra</p>
            </div>
          </CardContent>
        </Card>
      )}

      {sub && (
        <Card className="mt-4">
          <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><Sparkles className="size-4 text-primary" aria-hidden="true" /> Modules included</CardTitle></CardHeader>
          <CardContent>
            <ul className="grid gap-2 sm:grid-cols-2">
              {ADDONS.map((a) => {
                const on = sub.effectiveAddons.includes(a.id);
                return (
                  <li key={a.id} className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${on ? "" : "opacity-50"}`}>
                    <Check className={`mt-0.5 size-4 shrink-0 ${on ? "text-emerald-600" : "text-muted-foreground"}`} aria-hidden="true" />
                    <span><span className="font-medium">{a.name}</span> — <span className="text-muted-foreground">{a.desc}</span></span>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      <h2 className="mt-6 mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Plans</h2>
      <div className="grid gap-3 lg:grid-cols-3">
        {PLANS.map((p) => {
          const isCurrent = sub?.plan === p.id;
          return (
            <div key={p.id} className={`flex flex-col rounded-2xl border p-5 shadow-sm ${isCurrent ? "border-primary ring-1 ring-primary" : "bg-card"}`}>
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">{p.name}</h3>
                {isCurrent ? <span className="rounded-full bg-primary px-2 py-0.5 text-[11px] font-medium text-primary-foreground">Current</span> : null}
              </div>
              <p className="mt-0.5 text-sm text-muted-foreground">{p.tagline}</p>
              <p className="mt-3"><span className="font-display text-2xl font-bold">{inr(p.pricePerPropertyMonth)}</span><span className="text-sm text-muted-foreground">/property/mo</span></p>
              <ul className="mt-4 space-y-1.5 text-sm">
                {p.includes.map((f) => (
                  <li key={f} className="flex items-start gap-2"><Check className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden="true" /> {f}</li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
      <p className="mt-4 text-center text-xs text-muted-foreground">To change your plan or add modules, contact your Woodpecker account manager.</p>
    </div>
  );
}
