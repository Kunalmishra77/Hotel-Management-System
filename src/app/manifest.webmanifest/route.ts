/**
 * PWA manifest — 00 T-21 ("PWA scaffold hook").
 *
 * mobile-first.md: "Installable PWA (manifest + service worker). One codebase
 * covers all four devices — no native apps in scope."
 *
 * 00 provides only the installable shell scaffold; full offline + background
 * sync is spec 17-mobile-experience, which adds the service worker.
 */
export const runtime = "edge";

export function GET(): Response {
  const manifest = {
    name: "Woodpecker PMS",
    short_name: "Woodpecker",
    description: "Property Management System for Woodpecker Apartments & Suites",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#ffffff",
    theme_color: "#0b6b73",
    lang: "en-IN",
    categories: ["business", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };

  return new Response(JSON.stringify(manifest, null, 2), {
    headers: {
      "content-type": "application/manifest+json",
      "cache-control": "public, max-age=3600",
    },
  });
}
