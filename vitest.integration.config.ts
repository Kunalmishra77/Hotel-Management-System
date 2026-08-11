import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Integration-only config that adds the per-file DB reset (tests/integration-reset.ts)
// on top of the shared setup. Kept separate from vitest.config.ts so the fast unit
// suite never loads the reset. Run with: `npm run test:integration` (needs .env.test
// with RESET_DB_PER_FILE=true pointing at a throwaway local DB — see .env.test.example).
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
    include: ["tests/integration/**/*.test.ts"],
    setupFiles: ["tests/setup.ts", "tests/integration-reset.ts"],
    pool: "threads",
    poolOptions: { threads: { minThreads: 1, maxThreads: 1 } },
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
