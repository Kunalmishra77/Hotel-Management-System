"use client";

/**
 * Integrations status board (16). One org-admin screen showing every external
 * provider's sandbox↔live mode + go-live blocker. Messaging channels are
 * toggleable here; payments/accounting/channels/AI are read-only status with
 * deep-links to the consoles that own their deep config.
 */
import { useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { ArrowUpRight, MessageSquare, CreditCard, BookText, Radio, Sparkles } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { setMessagingMode } from "../actions";
import type { IntegrationsOverview, MessagingChannelStatus } from "../queries";

export function IntegrationsConsole({ overview }: { overview: IntegrationsOverview }) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base [&_svg]:size-4 [&_svg]:text-primary">
            <MessageSquare /> Messaging
          </CardTitle>
          <CardDescription>
            Toggle a channel to live once its provider is onboarded. Sandbox uses the mock provider — the
            app sends nothing externally.
          </CardDescription>
        </CardHeader>
        <CardContent className="divide-y divide-border">
          {overview.messaging.map((m) => (
            <MessagingRow key={m.channel} status={m} />
          ))}
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        <ReadOnlyCard
          icon={<CreditCard />}
          title="Payments"
          mode={overview.payments.mode}
          rows={[
            ["Provider", overview.payments.provider],
            ["Live adapter", overview.payments.liveAdapterBuilt ? "wired" : "not built yet"],
          ]}
          blocker={overview.payments.blocker}
        />

        <ReadOnlyCard
          icon={<BookText />}
          title="Accounting"
          mode={overview.accounting.some((a) => a.mode === "live") ? "live" : "sandbox"}
          rows={overview.accounting.map(
            (a): [string, string] => [a.provider, a.configured ? a.mode : `${a.mode} (default)`],
          )}
          link={{ href: "/accounting", label: "Open accounting" }}
        />

        <ReadOnlyCard
          icon={<Radio />}
          title="OTA channels"
          mode={overview.channels.live > 0 ? "live" : "sandbox"}
          rows={[
            ["Connections", String(overview.channels.total)],
            ["Live / sandbox", `${overview.channels.live} / ${overview.channels.sandbox}`],
          ]}
          link={{ href: "/channels", label: "Open channels" }}
        />

        <ReadOnlyCard
          icon={<Sparkles />}
          title="AI"
          mode={overview.ai.live ? "live" : "sandbox"}
          rows={[
            ["Provider", overview.ai.provider],
            ["Selected by", "AI_PROVIDER env"],
          ]}
          blocker={overview.ai.live ? undefined : "Mock provider returns deterministic stubs — no API key needed."}
        />
      </div>
    </div>
  );
}

function ModePill({ mode }: { mode: "sandbox" | "live" }) {
  return mode === "live" ? (
    <Badge variant="success">Live</Badge>
  ) : (
    <Badge variant="secondary">Sandbox</Badge>
  );
}

function MessagingRow({ status }: { status: MessagingChannelStatus }) {
  const [mode, setMode] = useState<"sandbox" | "live">(status.mode);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onToggle(checked: boolean) {
    const next = checked ? "live" : "sandbox";
    setError(null);
    startTransition(async () => {
      const res = await setMessagingMode({ channel: status.channel, provider: status.provider, mode: next });
      if (res.ok) setMode(next);
      else setError(res.error.message);
    });
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium">{status.label}</p>
          <ModePill mode={mode} />
        </div>
        <p className="text-xs text-muted-foreground">
          {status.provider}
          {mode === "live" ? <> · blocker: {status.blocker}</> : null}
        </p>
        {error ? (
          <p role="alert" className="mt-1 text-xs text-destructive" data-testid={`msg-error-${status.channel}`}>
            {error}
          </p>
        ) : null}
      </div>
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        {mode === "live" ? "Live" : "Sandbox"}
        <Switch
          checked={mode === "live"}
          onCheckedChange={onToggle}
          disabled={pending}
          aria-label={`Toggle ${status.label} live`}
          data-testid={`msg-toggle-${status.channel}`}
        />
      </label>
    </div>
  );
}

function ReadOnlyCard({
  icon,
  title,
  mode,
  rows,
  blocker,
  link,
}: {
  icon: ReactNode;
  title: string;
  mode: "sandbox" | "live";
  rows: [string, string][];
  blocker?: string;
  link?: { href: string; label: string };
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-base">
          <span className="flex items-center gap-2 [&_svg]:size-4 [&_svg]:text-primary">
            {icon} {title}
          </span>
          <ModePill mode={mode} />
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <dl className="space-y-1 text-sm">
          {rows.map(([k, v], i) => (
            <div key={`${k}-${i}`} className="flex items-center justify-between gap-3">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="truncate font-medium">{v}</dd>
            </div>
          ))}
        </dl>
        {blocker ? <p className="text-xs text-muted-foreground">{blocker}</p> : null}
        {link ? (
          <Link
            href={link.href}
            className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline [&_svg]:size-3.5"
          >
            {link.label} <ArrowUpRight />
          </Link>
        ) : null}
      </CardContent>
    </Card>
  );
}
