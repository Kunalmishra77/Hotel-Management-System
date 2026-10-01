/**
 * #24 — a guest's communication history ("Conversation"): every automated/manual
 * message sent to them across channels, newest first. Read-only; addresses are
 * already masked by the query. Rendered on the guest profile.
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type GuestMessage = {
  id: string;
  channel: string;
  category: string | null;
  templateKey: string | null;
  toAddress: string;
  status: string;
  createdAt: Date;
};

const CHANNEL_LABEL: Record<string, string> = { WHATSAPP: "WhatsApp", EMAIL: "Email", SMS: "SMS" };
const STATUS_TONE: Record<string, string> = {
  DELIVERED: "text-success", READ: "text-success", SENT: "text-muted-foreground",
  QUEUED: "text-muted-foreground", FAILED: "text-destructive",
};
const prettify = (s: string | null) => (s ? s.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : "");

export function GuestConversationCard({ messages }: { messages: GuestMessage[] }) {
  return (
    <Card>
      <CardHeader className="pb-3"><CardTitle className="text-base">Conversation · messages sent</CardTitle></CardHeader>
      <CardContent>
        {messages.length === 0 ? (
          <p className="text-sm text-muted-foreground">No messages sent to this guest yet. Booking, check-in, check-out and follow-up messages appear here automatically.</p>
        ) : (
          <ul className="divide-y rounded-md border" data-testid="guest-conversation">
            {messages.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                <div className="min-w-0">
                  <p className="font-medium">{CHANNEL_LABEL[m.channel] ?? m.channel} · {prettify(m.templateKey) || prettify(m.category) || "Message"}</p>
                  <p className="text-xs text-muted-foreground">{m.toAddress} · {new Date(m.createdAt).toLocaleString("en-IN")}</p>
                </div>
                <span className={`text-xs font-medium ${STATUS_TONE[m.status] ?? "text-muted-foreground"}`}>{prettify(m.status)}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
