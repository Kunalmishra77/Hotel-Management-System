import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { ServiceWorkerRegistrar } from "@/components/pwa/service-worker-registrar";
import "@/styles/globals.css";

/**
 * Design system typography (ui-foundation.md), exposed as CSS variables that
 * Tailwind consumes.
 *
 * The font FILES live in `./fonts` and are served from our own origin — no CDN
 * at runtime, and, which is the point, no network at BUILD time either.
 *
 * These were `next/font/google` until a deploy failed on it. That loader fetches
 * the font CSS from fonts.googleapis.com while `next build` runs, so the build
 * only succeeds where Google is reachable; when the response is not what the
 * loader expects (blocked, redirected, or rate-limited — datacenter IPs get
 * throttled) its URL regex returns null and the build dies with a bare
 * `TypeError: Cannot read properties of null (reading '1')`. Identical source
 * built fine on a laptop and failed in the deploy container, which is the whole
 * problem: a third-party CDN was a hard dependency of every release.
 *
 * Variable faces, one file per family, so every weight the design system uses is
 * covered without shipping a file per weight. `weight` therefore declares the
 * axis RANGE rather than a single value.
 *
 * To update a face, replace the .woff2 — do not reintroduce next/font/google.
 */

// Only the body font is PRELOADED — it is used on every page above the fold.
const fontSans = localFont({
  src: "./fonts/Inter-Variable.woff2",
  variable: "--font-sans",
  display: "swap",
  weight: "100 900",
});

/**
 * The display/serif/mono faces are used selectively, so preloading them on every
 * route makes the browser warn "preloaded but not used"; `preload: false` loads
 * them on demand (still flash-free via `display: swap`) and trims the initial
 * request list.
 */
const fontDisplay = localFont({
  src: "./fonts/SpaceGrotesk-Variable.woff2",
  variable: "--font-display",
  display: "swap",
  weight: "300 700",
  preload: false,
});

const fontSerif = localFont({
  src: "./fonts/Fraunces-Variable.woff2",
  variable: "--font-serif",
  display: "swap",
  // Was weight: ["400","500","600","700"] — the variable face spans the range.
  weight: "100 900",
  preload: false,
  // A serif that falls back to Arial metrics shifts visibly; match the genre.
  adjustFontFallback: "Times New Roman",
});

const fontMono = localFont({
  src: "./fonts/JetBrainsMono-Variable.woff2",
  variable: "--font-mono",
  display: "swap",
  weight: "100 800",
  preload: false,
});

export const metadata: Metadata = {
  title: {
    default: "Woodpecker PMS",
    template: "%s · Woodpecker PMS",
  },
  description: "Property Management System for Woodpecker Apartments & Suites",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Woodpecker PMS", statusBarStyle: "default" },
  // Staff-only application; never index it.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Deliberately NOT maximum-scale=1: blocking pinch-zoom fails WCAG 1.4.4,
  // and mobile-first.md requires AA. iOS auto-zoom is prevented by the 16px
  // base font instead (globals.css).
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7fafa" },
    { media: "(prefers-color-scheme: dark)", color: "#0b1416" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en-IN"
      suppressHydrationWarning
      className={`${fontSans.variable} ${fontDisplay.variable} ${fontSerif.variable} ${fontMono.variable}`}
    >
      <body className="min-h-dvh bg-background font-sans text-foreground antialiased">
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
          {children}
          <Toaster />
          <ServiceWorkerRegistrar />
        </ThemeProvider>
      </body>
    </html>
  );
}
