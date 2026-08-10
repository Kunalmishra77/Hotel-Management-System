"use client";

/**
 * 12 T-22/T-23 — Communications console (mobile-first). Tabs for Templates,
 * Automations, Campaigns (builder + history) and the Message Log with status
 * filters. Presentational — all data is fetched + masked server-side.
 */
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CampaignBuilder } from "./campaign-builder";

type Template = { id: string; key: string; channel: string; language: string; providerTemplateId: string | null; isActive: boolean };
type Automation = { id: string; category: string; triggerEvent: string | null; scheduleOffsetMinutes: number | null; templateKey: string; channel: string; isActive: boolean };
type Campaign = { id: string; templateKey: string; channel: string; status: string; createdAt: Date };
type LogRow = { id: string; channel: string; category: string | null; templateKey: string | null; toAddress: string; status: string; error: string | null; deadLetteredAt: Date | null; createdAt: Date };

type Tab = "templates" | "automations" | "campaigns" | "log";

const STATUS_STYLES: Record<string, string> = {
  QUEUED: "bg-amber-100 text-amber-800",
  SENT: "bg-blue-100 text-blue-800",
  DELIVERED: "bg-emerald-100 text-emerald-800",
  READ: "bg-emerald-100 text-emerald-800",
  FAILED: "bg-red-100 text-red-800",
};

export function CommunicationsScreen(props: {
  templates: Template[];
  automations: Automation[];
  campaigns: Campaign[];
  log: LogRow[];
  templateKeys: string[];
  segments: { id: string; name: string; size: number }[];
  canManage: boolean;
  propertyId: string | null;
}) {
  const [tab, setTab] = useState<Tab>("templates");
  const [statusFilter, setStatusFilter] = useState<string>("");

  const tabs: { key: Tab; label: string }[] = [
    { key: "templates", label: "Templates" },
    { key: "automations", label: "Automations" },
    { key: "campaigns", label: "Campaigns" },
    { key: "log", label: "Message log" },
  ];

  const filteredLog = statusFilter ? props.log.filter((r) => r.status === statusFilter) : props.log;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 p-4">
      <h1 className="text-xl font-semibold">Communications</h1>

      <div className="flex gap-1 overflow-x-auto" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`min-h-11 shrink-0 rounded-md px-3 text-sm ${tab === t.key ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "templates" && (
        <ul className="space-y-2" data-testid="template-list">
          {props.templates.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-3 rounded-md border p-3">
              <div className="min-w-0">
                <p className="truncate font-medium">{t.key}</p>
                <p className="text-sm text-muted-foreground">{t.channel} · {t.language}{t.providerTemplateId ? " · approved" : ""}</p>
              </div>
              <span className="shrink-0 text-xs">{t.isActive ? "active" : "inactive"} {t.channel === "WHATSAPP" && !t.providerTemplateId ? "🔒" : ""}</span>
            </li>
          ))}
          {props.templates.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">No templates yet.</p>}
        </ul>
      )}

      {tab === "automations" && (
        <ul className="space-y-2" data-testid="automation-list">
          {props.automations.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-3 rounded-md border p-3">
              <div className="min-w-0">
                <p className="truncate font-medium">{a.templateKey}</p>
                <p className="text-sm text-muted-foreground">
                  {a.category} · {a.channel} · {a.triggerEvent ? `on ${a.triggerEvent}` : `${a.scheduleOffsetMinutes}m offset`}
                </p>
              </div>
              <span className="shrink-0 text-xs">{a.isActive ? "active" : "inactive"}</span>
            </li>
          ))}
          {props.automations.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">No automations yet.</p>}
        </ul>
      )}

      {tab === "campaigns" && (
        <div className="space-y-4">
          {props.canManage && <CampaignBuilder templateKeys={props.templateKeys} segments={props.segments} propertyId={props.propertyId} />}
          <Card>
            <CardHeader><CardTitle className="text-base">Recent campaigns</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {props.campaigns.map((c) => (
                <div key={c.id} className="flex items-center justify-between rounded-md border p-2 text-sm">
                  <span>{c.templateKey} · {c.channel}</span>
                  <span className="text-muted-foreground">{c.status}</span>
                </div>
              ))}
              {props.campaigns.length === 0 && <p className="text-sm text-muted-foreground">No campaigns yet.</p>}
            </CardContent>
          </Card>
        </div>
      )}

      {tab === "log" && (
        <div className="space-y-3" data-testid="message-log">
          <div className="flex gap-1 overflow-x-auto">
            {["", "QUEUED", "SENT", "DELIVERED", "FAILED"].map((s) => (
              <button
                key={s || "all"}
                onClick={() => setStatusFilter(s)}
                className={`min-h-9 shrink-0 rounded-md px-2 text-xs ${statusFilter === s ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
              >
                {s || "All"}
              </button>
            ))}
          </div>
          <ul className="space-y-2">
            {filteredLog.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 rounded-md border p-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{r.templateKey ?? "—"}</p>
                  <p className="truncate text-sm text-muted-foreground">{r.channel} · {r.toAddress}{r.error ? ` · ${r.error}` : ""}</p>
                </div>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${STATUS_STYLES[r.status] ?? "bg-muted"}`}>{r.status}</span>
              </li>
            ))}
            {filteredLog.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">No messages.</p>}
          </ul>
        </div>
      )}
    </div>
  );
}
