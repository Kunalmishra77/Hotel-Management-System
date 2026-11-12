/**
 * Auth route-group shell — the Concierge brand layer (deep pine, brass, serif
 * wordmark). The signature element is a brass room-key tag: the one object every
 * guest of a serviced apartment holds, engraved with the brand. On phones it
 * shrinks into a pine header band above the form; on laptops it anchors a full
 * brand panel. No navigation — there is nowhere to go until signed in.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="grid min-h-dvh bg-background lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      {/* Brand panel — laptop/tablet-landscape */}
      <aside className="relative hidden overflow-hidden bg-brand-pine text-brand-pine-foreground lg:flex lg:flex-col lg:justify-between lg:p-12">
        <PineGrain />
        <div className="relative">
          <Wordmark />
        </div>

        <div className="relative flex items-end gap-10">
          <KeyTag id="tag-lg" className="w-36 shrink-0 origin-top motion-safe:animate-tag-settle xl:w-44" />
          <div className="max-w-xs pb-3">
            <h2 className="text-balance font-serif text-[28px] leading-[1.2]">
              Every room, guest and bill, in one place.
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-brand-pine-foreground/70">
              Bookings, check-ins, GST invoices and housekeeping for all Woodpecker properties.
            </p>
          </div>
        </div>

        <p className="relative text-xs text-brand-pine-foreground/50">
          © {new Date().getFullYear()} Woodpecker Apartments &amp; Suites Pvt. Ltd., New Delhi
        </p>
      </aside>

      {/* Form column */}
      <div className="flex flex-col">
        {/* Phone header band */}
        <header className="relative overflow-hidden bg-brand-pine px-4 pb-14 pt-7 text-brand-pine-foreground lg:hidden">
          <PineGrain />
          <div className="relative flex items-center justify-between gap-4">
            <Wordmark compact />
            <KeyTag id="tag-sm" className="-my-3 w-11 shrink-0 rotate-6" />
          </div>
        </header>

        <div className="-mt-8 flex flex-1 flex-col items-center px-4 pb-10 lg:mt-0 lg:justify-center lg:px-10">
          <div className="w-full max-w-[400px] rounded-2xl bg-background px-5 pt-7 shadow-[0_-8px_24px_-12px_hsl(var(--brand-pine)/0.35)] animate-fade-in sm:px-7 lg:rounded-none lg:p-0 lg:shadow-none">
            {children}
          </div>
          <p className="mt-8 text-center text-xs text-muted-foreground">
            Trouble signing in? Ask your administrator to reset your access.
          </p>
        </div>
      </div>
    </main>
  );
}

function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <div>
      <p className={`font-serif font-semibold tracking-tight ${compact ? "text-2xl" : "text-3xl"}`}>Woodpecker</p>
      <p className="mt-0.5 text-sm text-brand-pine-foreground/70">Apartments &amp; Suites</p>
    </div>
  );
}

/** Fine diagonal grain so the pine reads as a material, not a flat fill. */
function PineGrain() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 opacity-[0.07]"
      style={{
        backgroundImage:
          "repeating-linear-gradient(115deg, currentColor 0 1px, transparent 1px 9px), radial-gradient(circle at 85% 10%, hsl(var(--brand-brass)) 0, transparent 45%)",
      }}
    />
  );
}

/** A brass hotel key tag on its ring — decorative, hidden from assistive tech. */
function KeyTag({ id, className }: { id: string; className?: string }) {
  // Unique per instance: the phone and laptop tags are both in the DOM, and a
  // shared gradient id would resolve to the hidden copy and paint nothing.
  const face = `${id}-face`;
  return (
    <svg viewBox="0 0 120 230" className={className} aria-hidden focusable="false">
      <defs>
        <linearGradient id={face} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="hsl(40 62% 66%)" />
          <stop offset="0.55" stopColor="hsl(37 48% 47%)" />
          <stop offset="1" stopColor="hsl(33 45% 34%)" />
        </linearGradient>
      </defs>
      {/* ring */}
      <circle cx="60" cy="22" r="17" fill="none" stroke="hsl(40 30% 88%)" strokeOpacity="0.75" strokeWidth="3" />
      {/* tag body: rounded shoulders, pointed tail */}
      <path
        d="M30 52 Q30 38 44 38 H76 Q90 38 90 52 V178 L60 214 L30 178 Z"
        fill={`url(#${face})`}
        stroke="hsl(33 45% 28%)"
        strokeOpacity="0.5"
        strokeWidth="1.2"
      />
      {/* punched hole */}
      <circle cx="60" cy="54" r="6.5" fill="hsl(var(--brand-pine))" stroke="hsl(33 45% 28%)" strokeOpacity="0.6" />
      {/* engraving */}
      <g fill="hsl(33 50% 22%)" fillOpacity="0.85" textAnchor="middle">
        <text x="60" y="96" fontFamily="var(--font-serif), Georgia, serif" fontSize="15" fontWeight="600">W</text>
        <line x1="44" y1="106" x2="76" y2="106" stroke="hsl(33 50% 22%)" strokeOpacity="0.5" strokeWidth="0.8" />
        <text x="60" y="136" fontFamily="var(--font-serif), Georgia, serif" fontSize="22" fontWeight="600">D-1</text>
        <text x="60" y="158" fontFamily="var(--font-sans), sans-serif" fontSize="6.5" letterSpacing="0.8">HAUZ KHAS</text>
      </g>
    </svg>
  );
}
