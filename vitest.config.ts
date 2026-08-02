import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Two projects so the fast, pure unit suite never waits on a database:
//   unit        — domain + lib pure logic, no I/O (rules/testing-strategy.md §1)
//   integration — server actions against a real Postgres (rules/testing-strategy.md §2)
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    // Integration tests share ONE Postgres schema and mutate the same seeded
    // fixture rows, so test files must not overlap. `fileParallelism: false` is
    // what actually serialises files — `poolOptions.threads.singleThread` only
    // constrains threads within a worker and is deprecated in Vitest 2.
    pool: "threads",
    poolOptions: { threads: { minThreads: 1, maxThreads: 1 } },
    fileParallelism: false,
    // 60s, not because any test does 60s of work: the FIRST database-touching
    // test in a file pays for a cold Prisma engine plus a cold TLS connection to
    // a managed database in another region, which has been observed above 35s.
    // A tighter bound reports a passing suite as broken.
    testTimeout: 60_000,
    // Hooks default to 10s independently of testTimeout. Integration setup and
    // cleanup hit a managed database over the network, so they need the same
    // headroom as the tests themselves.
    hookTimeout: 30_000,
    coverage: {
      provider: "v8",
      include: ["src/lib/**/*.ts", "src/features/**/domain/**/*.ts"],
      exclude: ["**/*.d.ts", "**/index.ts"],
      // Domain coverage gate — rules/testing-strategy.md
      thresholds: { lines: 90, branches: 90, functions: 90, statements: 90 },
    },
  },
});
