/*
 * Woodpecker PMS service worker (17 T-2, FR-2). Hand-rolled, zero-dependency.
 *
 * Scope, deliberately conservative for a PMS that handles PII:
 *   - Precache a branded offline fallback + the app icons.
 *   - Static build assets (/_next/static, /icons, fonts) → stale-while-revalidate,
 *     which is what makes a warm load fast (AC-2).
 *   - Navigations (HTML) → network-first, falling back to /offline.html. We NEVER
 *     cache authenticated HTML: guest/billing pages carry PII and must not persist
 *     in the Cache API (compliance.md). Offline DATA is handled by the IndexedDB
 *     queue (17 T-3), not by caching pages.
 *   - /api/* and any non-GET → passthrough, never touched.
 *
 * Bump CACHE_VERSION to invalidate old caches on deploy.
 */
const CACHE_VERSION = "wp-v2";
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const ASSET_CACHE = `${CACHE_VERSION}-assets`;
const OFFLINE_URL = "/offline.html";

const PRECACHE = [
  OFFLINE_URL,
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => !k.startsWith(CACHE_VERSION)).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

function isStaticAsset(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname === "/manifest.webmanifest" ||
    /\.(?:js|css|woff2?|png|svg|ico)$/.test(url.pathname)
  );
}

// Cache-first with a background refresh — fast warm loads, self-healing on deploy.
async function staleWhileRevalidate(request) {
  const cache = await caches.open(ASSET_CACHE);
  const cached = await cache.match(request);
  if (cached) {
    // Serve the cached copy instantly; refresh in the background (ignore failures).
    fetch(request)
      .then((response) => {
        if (response && response.ok) cache.put(request, response.clone());
      })
      .catch(() => {});
    return cached;
  }
  // Not cached (e.g. a NEW build chunk after a deploy): go to the network. If the
  // fetch fails (e.g. the container is briefly cold during a rolling update), let
  // the error propagate so the browser handles/retries it — returning `undefined`
  // to respondWith() here is what broke asset loads ("Failed to fetch") post-deploy.
  const response = await fetch(request);
  if (response && response.ok) cache.put(request, response.clone());
  return response;
}

// Network-first for pages; the offline page is the only HTML we ever serve cached.
async function navigate(request) {
  try {
    return await fetch(request);
  } catch {
    const cache = await caches.open(SHELL_CACHE);
    const offline = await cache.match(OFFLINE_URL);
    return offline || Response.error();
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return; // never cache API/SSE

  if (request.mode === "navigate") {
    event.respondWith(navigate(request));
    return;
  }
  if (isStaticAsset(url)) {
    event.respondWith(staleWhileRevalidate(request));
  }
});
