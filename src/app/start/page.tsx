import type { Metadata } from "next";
import Link from "next/link";
import { Check } from "lucide-react";
import { StartForm } from "@/features/onboarding/components/start-form";

export const metadata: Metadata = {
  title: "Start your free trial — Woodpecker PMS",
  description: "Spin up your hotel management workspace in a minute. 14-day free trial, no card required.",
};

/**
 * Public org self-signup (architecture v2 · SaaS multi-tenant onboarding). Creates
 * a new tenant workspace + its first administrator.
 */
export default function StartPage() {
  return (
    <main className="min-h-dvh bg-muted/20">
      <div className="mx-auto grid min-h-dvh w-full max-w-5xl items-center gap-10 px-5 py-10 lg:grid-cols-2">
        <div className="hidden lg:block">
          <Link href="/product" className="text-lg font-semibold tracking-tight text-primary">Woodpecker</Link>
          <h1 className="mt-6 text-balance text-3xl font-semibold tracking-tight">Your hotel platform, ready in a minute.</h1>
          <p className="mt-3 text-pretty text-muted-foreground">One workspace for every property — reservations, GST billing, housekeeping, and more.</p>
          <ul className="mt-6 space-y-2 text-sm">
            {["Add unlimited staff & roles", "Multi-property from day one", "GST-compliant billing built in", "Runs on any phone"].map((f) => (
              <li key={f} className="flex items-center gap-2"><Check className="size-4 text-emerald-600" aria-hidden="true" /> {f}</li>
            ))}
          </ul>
        </div>

        <div>
          <div className="rounded-2xl border bg-card p-6 shadow-sm sm:p-8">
            <h2 className="text-xl font-semibold tracking-tight">Start your free trial</h2>
            <p className="mt-1 text-sm text-muted-foreground">Create your workspace and admin account.</p>
            <div className="mt-6"><StartForm /></div>
            <p className="mt-4 text-center text-sm text-muted-foreground">
              Already have an account? <Link href="/sign-in" className="font-medium text-primary hover:underline">Sign in</Link>
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
