/**
 * Administrator alerting — 00 FR-24 (backup success/failure), FR-19
 * (dead-letter), observability.md (job/webhook/backup failure alerts).
 *
 * Provider-abstracted per integrations.md: with no live credentials this
 * degrades to a structured log line and the app still runs end-to-end. Going
 * live is a config change — module 12 (communications) registers a real
 * transport against this same interface.
 */
import { logger } from "../logger";

export type AlertSeverity = "info" | "warning" | "critical";

export type Alert = {
  severity: AlertSeverity;
  /** Stable machine key, e.g. "backup.failed" — alert rules match on this. */
  code: string;
  title: string;
  detail?: Record<string, unknown>;
};

export type AlertTransport = {
  name: string;
  send: (alert: Alert) => Promise<void>;
};

/**
 * The sandbox transport. Not a stub that throws away the alert — it emits a
 * structured log at the right level, which is what an operator watches in dev
 * and CI, and what a log-based alerting rule would match in production.
 */
const sandboxTransport: AlertTransport = {
  name: "sandbox",
  async send(alert) {
    const meta = { code: alert.code, ...alert.detail };
    if (alert.severity === "critical") logger.error(`alert:${alert.title}`, meta);
    else if (alert.severity === "warning") logger.warn(`alert:${alert.title}`, meta);
    else logger.info(`alert:${alert.title}`, meta);
  },
};

let transport: AlertTransport = sandboxTransport;

export function setAlertTransport(next: AlertTransport): void {
  transport = next;
}

export function resetAlertTransport(): void {
  transport = sandboxTransport;
}

export function currentAlertTransport(): AlertTransport {
  return transport;
}

/**
 * Send an alert. Never throws: an alerting failure must not fail the operation
 * that raised it — a backup that succeeded but could not be announced is still
 * a successful backup.
 */
export async function alertAdmin(alert: Alert): Promise<void> {
  try {
    await transport.send(alert);
  } catch (e) {
    logger.error("alert.transport_failed", {
      transport: transport.name,
      code: alert.code,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
