import type { NextConfig } from "next";

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
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
