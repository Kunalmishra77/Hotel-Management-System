/**
 * SMTP email adapter — 12 (integrations.md golden rule, ADR 0001-smtp-email).
 *
 * A real EMAIL provider behind the same `MessagingProvider` interface, so going
 * live is a config change, never a code change. Built for the client's chosen
 * path: a Gmail / Google Workspace mailbox reached over SMTP with an app password.
 *
 * Credentials come from ENV only (security.md — secrets never in the DB row or
 * logs): SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM. When any are
 * missing the adapter reports a failed (never-throwing) result so the worker's
 * retry/dead-letter path stays in control and the front desk is never blocked.
 *
 * Gmail specifics for the operator:
 *   - Enable 2-Step Verification on the mailbox, then create an "App password"
 *     and use it as SMTP_PASS (a normal account password will be rejected).
 *   - SMTP_HOST=smtp.gmail.com, SMTP_PORT=587 (STARTTLS) or 465 (SSL).
 *   - Deliverability is best from a Workspace address on the hotel's own domain
 *     (info@woodpecker4me.com) with SPF/DKIM set; a plain @gmail.com sends but is
 *     more likely to be marked "via gmail".
 */
import type { Channel } from "@prisma/client";
import { logger } from "@/lib/logger";
import type { MessagingAccountConfig, MessagingProvider, OutboundMessage, SendResult } from "./types";

/** Human subject lines per template key (email needs a subject; the body is the
 *  rendered template). A key with no entry falls back to the company name. */
const SUBJECTS: Record<string, string> = {
  BOOKING_CONFIRMATION: "Your booking is confirmed",
  WELCOME_CHECKIN: "Welcome — you're checked in",
  CHECKOUT_THANKYOU: "Thank you for your stay",
  PRE_ARRIVAL: "We look forward to your arrival",
  INVOICE_SHARE: "Your invoice",
};
const DEFAULT_SUBJECT = "Woodpecker Apartments & Suites";

type SmtpEnv = { host: string; port: number; user: string; pass: string; from: string; secure: boolean };

/** Read + validate SMTP settings from the environment. Null when not configured. */
function readSmtpEnv(): SmtpEnv | null {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM ?? process.env.SMTP_USER;
  if (!host || !user || !pass || !from) return null;
  const port = Number(process.env.SMTP_PORT ?? 587);
  return { host, port, user, pass, from, secure: port === 465 };
}

export function smtpEmailProvider(_config: MessagingAccountConfig): MessagingProvider {
  const channel: Channel = "EMAIL";

  const send = async (message: OutboundMessage): Promise<SendResult> => {
    const env = readSmtpEnv();
    if (!env) {
      return { ok: false, error: "SMTP not configured — set SMTP_HOST/PORT/USER/PASS/FROM to send live email." };
    }
    try {
      // Imported lazily so the dependency never loads on the request path / in the
      // mock (sandbox) flow — only when a live SMTP send actually happens.
      const nodemailer = await import("nodemailer");
      const transport = nodemailer.createTransport({
        host: env.host,
        port: env.port,
        secure: env.secure,
        auth: { user: env.user, pass: env.pass },
      });
      const subject = (message.templateKey && SUBJECTS[message.templateKey]) || DEFAULT_SUBJECT;
      const info = await transport.sendMail({
        from: env.from,
        to: message.toAddress,
        subject,
        text: message.body,
      });
      return { ok: true, providerRef: info.messageId ?? `smtp-${Date.now()}` };
    } catch (e) {
      // Never leak the address or credentials; log the reason only.
      logger.error("smtp.send_failed", { reason: e instanceof Error ? e.message : "unknown" });
      return { ok: false, error: "SMTP send failed." };
    }
  };

  return {
    name: "smtp:email",
    channel,
    isLive: true,
    // Email has no template/session distinction at the provider — both send a mail.
    sendTemplate: send,
    sendSession: send,
    // Email has no inbound webhook signature in this setup; accept (nothing to verify).
    verifyWebhook: () => true,
    async deliveryStatus() {
      return "SENT";
    },
  };
}
