/**
 * For maintenance scripts that must run the app's real server actions (GST
 * invoices: numbering, credit notes, PDFs, audit) outside a browser request.
 * Redirects `@/lib/auth` to a stub whose requireUser() returns the claims the
 * script put on globalThis.__SCRIPT_CLAIMS (a real, assembled user), and
 * `next/cache` to no-ops. Load with:  npx tsx --require ./scripts/lib/as-user-hook.cjs …
 */
const { registerHooks } = require("node:module");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const stubs = {
  "@/lib/auth": pathToFileURL(path.join(__dirname, "auth-stub.ts")).href,
  "next/cache": pathToFileURL(path.join(__dirname, "next-cache-stub.cjs")).href,
};
registerHooks({
  resolve(specifier, context, next) {
    const to = stubs[specifier];
    // The stub itself imports the real module by relative path, so no loop.
    if (to && !(context.parentURL || "").includes("auth-stub")) return { url: to, shortCircuit: true, format: specifier === "next/cache" ? "commonjs" : undefined };
    return next(specifier, context);
  },
});
