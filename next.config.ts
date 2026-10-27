import type { NextConfig } from "next";

const PORTFOLIO_FRAME_ANCESTORS =
  process.env.PORTFOLIO_FRAME_ANCESTORS ??
  "https://agentix-portfolio.vercel.app https://ai-agentix.com https://*.ai-agentix.com";
const PUBLIC_PAGES = "portal|product|book";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    // Server Actions are used for mutations across the app.
    serverActions: { bodySizeLimit: "10mb" }, // ID/scan uploads
    // Enables forbidden() / unauthorized(), so an unauthorized page render
    // returns a real HTTP 403 as 00 FR-13 requires ("reject server-side with
    // FORBIDDEN (HTTP 403)"). Without this flag Next falls back to 404, which
    // would silently violate the spec.
    authInterrupts: true,
  },
  images: {
    // Object-storage host for guest ID scans / property images is added here.
    remotePatterns: [],
  },
  // PWA (mobile-first, offline housekeeping): service worker is registered
  // client-side in src/app/layout.tsx; headers below make the manifest cacheable.
  // Public guest/marketing pages may be framed by the AI Agentix portfolio;
  // every other route (staff app, auth, account, tokens, API) stays DENY.
  async headers() {
    const baseHeaders = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    ];
    const publicHeaders = [
      ...baseHeaders,
      { key: "Content-Security-Policy", value: `frame-ancestors 'self' ${PORTFOLIO_FRAME_ANCESTORS}` },
    ];
    const lockedHeaders = [
      ...baseHeaders,
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
    ];
    return [
      { source: "/", headers: publicHeaders },
      { source: `/:page(${PUBLIC_PAGES})/:rest*`, headers: publicHeaders },
      { source: `/((?!(?:${PUBLIC_PAGES})(?:/|$)).+)`, headers: lockedHeaders },
    ];
  },
};

export default nextConfig;
