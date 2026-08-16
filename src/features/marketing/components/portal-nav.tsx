"use client";
/**
 * Internal product-site navbar (`/portal`). Transparent over the dark hero, fades
 * to a solid ink bar on scroll. Mobile: a full-height ink drawer. Mirrors the
 * customer StayNav's behaviour in the platform's own teal/ink identity.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { Menu, X, ArrowRight } from "lucide-react";

const LINKS = [
  { href: "#platform", label: "Platform" },
  { href: "#roles", label: "Role portals" },
  { href: "#modules", label: "Modules" },
  { href: "#security", label: "Security" },
  { href: "#ai", label: "AI" },
];

export function PortalNav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className="fixed inset-x-0 top-0 z-50 transition-colors duration-300"
      style={{
        background: scrolled ? "var(--ink)" : "transparent",
        borderBottom: scrolled ? "1px solid rgba(255,255,255,.08)" : "1px solid transparent",
      }}
    >
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-4 py-4 sm:px-6">
        <Link href="/portal" className="flex items-baseline gap-2">
          <span className="serif text-xl font-bold tracking-tight" style={{ color: "#fff" }}>Woodpecker</span>
          <span className="hidden text-xs font-medium uppercase tracking-wider sm:inline" style={{ color: "var(--brass)" }}>PMS</span>
        </Link>

        <nav className="hidden items-center gap-7 lg:flex">
          {LINKS.map((l) => (
            <a key={l.href} href={l.href} className="text-sm font-medium transition-opacity hover:opacity-80" style={{ color: "#dbe9e9" }}>
              {l.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <Link href="/" className="hidden text-sm font-medium transition-opacity hover:opacity-80 md:inline" style={{ color: "#dbe9e9" }}>
            Guest site
          </Link>
          <Link href="/sign-in" className="p-btn p-btn-brass hidden sm:inline-flex" style={{ minHeight: "2.6rem", padding: "0 1.15rem", fontSize: "0.86rem" }}>
            Sign in <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
          <button type="button" onClick={() => setOpen(true)} aria-label="Menu" className="lg:hidden" style={{ color: "#fff" }}>
            <Menu className="size-6" />
          </button>
        </div>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" style={{ background: "var(--ink)" }}>
          <div className="flex items-center justify-between px-4 py-4">
            <span className="serif text-xl font-bold" style={{ color: "#fff" }}>Woodpecker PMS</span>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close" style={{ color: "#fff" }}><X className="size-6" /></button>
          </div>
          <nav className="flex flex-col gap-1 px-4 pt-6">
            {LINKS.map((l) => (
              <a key={l.href} href={l.href} onClick={() => setOpen(false)} className="border-b py-4 text-lg" style={{ color: "#eaf3f3", borderColor: "rgba(255,255,255,.1)" }}>
                {l.label}
              </a>
            ))}
            <Link href="/" onClick={() => setOpen(false)} className="py-4 text-lg" style={{ color: "#eaf3f3" }}>Guest site</Link>
            <Link href="/sign-in" onClick={() => setOpen(false)} className="p-btn p-btn-brass mt-4">Sign in <ArrowRight className="size-4" aria-hidden="true" /></Link>
          </nav>
        </div>
      )}
    </header>
  );
}
