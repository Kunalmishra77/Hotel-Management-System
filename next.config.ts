import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    // Server Actions are used for mutations across the app.
    serverActions: { bodySizeLimit: "10mb" }, // ID/scan uploads
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
