import type { Metadata, Viewport } from "next";
import { Inter, Space_Grotesk, Fraunces, JetBrains_Mono } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { ServiceWorkerRegistrar } from "@/components/pwa/service-worker-registrar";
import "@/styles/globals.css";

// Design system typography (ui-foundation.md). Self-hosted at build via next/font
// — no runtime CDN, works offline. Exposed as CSS variables consumed by Tailwind.
// Only the body font (Inter) is PRELOADED — it's used on every page above the
// fold. The display/serif/mono faces are used selectively, so preloading them on
// every route makes the browser warn "preloaded but not used"; `preload: false`
// loads them on demand (still flash-free via `display: swap`) and trims the
// initial request list.
const fontSans = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const fontDisplay = Space_Grotesk({ subsets: ["latin"], variable: "--font-display", display: "swap", preload: false });
const fontSerif = Fraunces({
  subsets: ["latin"],
  variable: "--font-serif",
  display: "swap",
  weight: ["400", "500", "600", "700"],
  preload: false,
});
const fontMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap", preload: false });

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
