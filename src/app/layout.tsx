import type { Metadata, Viewport } from "next";
import { Inter, Space_Grotesk, Fraunces, JetBrains_Mono } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import "@/styles/globals.css";

// Design system typography (ui-foundation.md). Self-hosted at build via next/font
// — no runtime CDN, works offline. Exposed as CSS variables consumed by Tailwind.
const fontSans = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const fontDisplay = Space_Grotesk({ subsets: ["latin"], variable: "--font-display", display: "swap" });
const fontSerif = Fraunces({
  subsets: ["latin"],
  variable: "--font-serif",
  display: "swap",
  weight: ["400", "500", "600", "700"],
});
const fontMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });

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
        </ThemeProvider>
      </body>
    </html>
  );
}
