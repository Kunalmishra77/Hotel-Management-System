import { Lock, ShieldCheck, Sparkles } from "lucide-react";

/**
 * Auth route-group shell — a premium branded split-screen (Concierge brand
 * layer: deep pine, brass accents, serif wordmark). The brand panel is a
 * desktop affordance; on phones the form takes the full screen with a compact
 * wordmark. No navigation — there is nowhere to go until signed in.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="grid min-h-dvh lg:grid-cols-2">
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-brand-pine p-10 text-brand-pine-foreground lg:flex">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full bg-brand-brass/15 blur-3xl"
        />
        <div className="relative">
          <p className="font-serif text-3xl font-semibold tracking-tight">Woodpecker</p>
          <p className="mt-1 text-sm text-brand-pine-foreground/70">Apartments &amp; Suites</p>
        </div>
        <div className="relative space-y-6">
          <h2 className="max-w-sm font-serif text-[26px] leading-snug">
            One platform to run every property.
          </h2>
          <ul className="space-y-3.5 text-sm text-brand-pine-foreground/85">
            <li className="flex items-center gap-3">
              <ShieldCheck className="size-5 shrink-0 text-brand-brass" /> Bank-grade security &amp; a full audit trail
            </li>
            <li className="flex items-center gap-3">
              <Sparkles className="size-5 shrink-0 text-brand-brass" /> AI assistance across every desk
            </li>
            <li className="flex items-center gap-3">
              <Lock className="size-5 shrink-0 text-brand-brass" /> Role-based access, scoped to each hotel
            </li>
          </ul>
        </div>
        <p className="relative text-xs text-brand-pine-foreground/50">
          © Woodpecker Apartments &amp; Suites Pvt. Ltd.
        </p>
      </aside>

      <div className="flex flex-col items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm animate-fade-in">
          <div className="mb-6 text-center lg:hidden">
            <p className="font-serif text-2xl font-semibold tracking-tight text-brand-pine">Woodpecker</p>
            <p className="mt-1 text-sm text-muted-foreground">Apartments &amp; Suites</p>
          </div>
          {children}
        </div>
      </div>
    </main>
  );
}
