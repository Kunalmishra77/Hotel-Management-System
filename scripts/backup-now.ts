/**
 * Run one backup immediately — `npm run backup:now`.
 *
 * The scheduled job lives in scripts/worker.ts; this is the manual trigger an
 * operator uses before a risky migration, and what the restore drill needs to
 * produce an artifact.
 */
import "dotenv/config";

import { PrismaClient } from "@prisma/client";
import { runBackup } from "../src/lib/backup";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const outcome = await runBackup(prisma);
  console.log(
    [
      `status:    ${outcome.status}`,
      `target:    ${outcome.target}`,
      `size:      ${outcome.sizeBytes ?? "-"} bytes`,
      `retention: removed ${outcome.retentionRemoved}`,
      outcome.error ? `error:     ${outcome.error}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
  );
  if (outcome.status === "FAILED") process.exitCode = 1;
}

main()
  .catch((e: unknown) => {
    console.error("Backup failed to run:", e);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
