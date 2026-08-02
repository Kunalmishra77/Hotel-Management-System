import type { Metadata, Viewport } from "next";
import "@/styles/globals.css";

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
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0b1220" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN" suppressHydrationWarning>
      <body className="min-h-dvh bg-background text-foreground">{children}</body>
    </html>
  );
}
