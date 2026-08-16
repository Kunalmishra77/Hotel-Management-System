"use client";
/**
 * Customer-website navbar (Kaaya-inspired). Transparent over the hero, fades to a
 * solid forest bar after scrolling. Mobile: a full-height forest drawer.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";

const LINKS = [
  { href: "/#stays", label: "Our stays" },
  { href: "/#experiences", label: "Experiences" },
  { href: "/#about", label: "About" },
  { href: "/#gallery", label: "Gallery" },
  { href: "/#contact", label: "Contact" },
];

export function StayNav({ bookHref = "/#stays" }: { bookHref?: string }) {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 60);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className="fixed inset-x-0 top-0 z-50 transition-colors duration-300"
      style={{ background: scrolled ? "var(--forest)" : "transparent", boxShadow: scrolled ? "0 1px 0 rgba(255,255,255,.08)" : "none" }}
    >
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-4 py-4 sm:px-6">
        <Link href="/" className="serif text-xl font-bold tracking-tight" style={{ color: "var(--stone)" }}>
          Woodpecker
        </Link>

        <nav className="hidden items-center gap-7 lg:flex">
          {LINKS.map((l) => (
            <a key={l.href} href={l.href} className="text-sm font-medium transition-colors hover:opacity-80" style={{ color: "var(--stone)" }}>
              {l.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <Link href="/account" className="hidden text-sm font-medium transition-colors hover:opacity-80 sm:inline" style={{ color: "var(--stone)" }}>
            Sign in
          </Link>
          <a href={bookHref} className="stay-btn stay-btn-primary hidden sm:inline-flex">Book a stay</a>
          <button type="button" onClick={() => setOpen(true)} aria-label="Menu" className="lg:hidden" style={{ color: "var(--stone)" }}>
            <Menu className="size-6" />
          </button>
        </div>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" style={{ background: "var(--forest)" }}>
          <div className="flex items-center justify-between px-4 py-4">
            <span className="serif text-xl font-bold" style={{ color: "var(--stone)" }}>Woodpecker</span>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close" style={{ color: "var(--stone)" }}><X className="size-6" /></button>
          </div>
          <nav className="flex flex-col gap-1 px-4 pt-6">
            {LINKS.map((l) => (
              <a key={l.href} href={l.href} onClick={() => setOpen(false)} className="border-b py-4 text-lg" style={{ color: "var(--stone)", borderColor: "rgba(245,240,232,.12)" }}>
                {l.label}
              </a>
            ))}
            <Link href="/account" onClick={() => setOpen(false)} className="py-4 text-lg" style={{ color: "var(--stone)" }}>Sign in</Link>
            <a href={bookHref} onClick={() => setOpen(false)} className="stay-btn stay-btn-primary mt-4">Book a stay</a>
          </nav>
        </div>
      )}
    </header>
  );
}
