"use client";

import { useState, useTransition } from "react";
import { Filter, Info, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatIstDateTime } from "@/lib/utils";
import { fetchAuditPage } from "../actions";
import { AUDIT_ENTITY_TYPES, type AuditRow } from "../internal";

const ALL = "__all__";

function hasDetails(r: AuditRow): boolean {
  return Boolean(r.reason || r.before || r.after);
}

export function AuditBrowser({ initial, initialCursor }: { initial: AuditRow[]; initialCursor: string | null }) {
  const [rows, setRows] = useState<AuditRow[]>(initial);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [action, setAction] = useState("");
  const [entityType, setEntityType] = useState(ALL);
  const [pending, start] = useTransition();

  const filters = () => ({
    action: action.trim() || undefined,
    entityType: entityType === ALL ? undefined : entityType,
  });

  const apply = () =>
    start(async () => {
      const r = await fetchAuditPage(filters());
      setRows(r.rows);
      setCursor(r.nextCursor);
    });

  const loadMore = () =>
    start(async () => {
      if (!cursor) return;
      const r = await fetchAuditPage(filters(), cursor);
      setRows((prev) => [...prev, ...r.rows]);
      setCursor(r.nextCursor);
    });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex-1 space-y-1.5" style={{ minWidth: 200 }}>
          <label className="text-xs font-medium text-muted-foreground" htmlFor="a-action">
            Action
          </label>
          <Input
            id="a-action"
            value={action}
            onChange={(e) => setAction(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && apply()}
            placeholder="e.g. user:, refund, checkout"
          />
        </div>
        <div className="space-y-1.5" style={{ minWidth: 180 }}>
          <label className="text-xs font-medium text-muted-foreground">Entity</label>
          <Select value={entityType} onValueChange={setEntityType}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All entities</SelectItem>
              {AUDIT_ENTITY_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button variant="outline" onClick={apply} disabled={pending}>
          <Filter /> Apply
        </Button>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={<Info />}
          title="No audit records"
          description="Nothing matches these filters yet. Business actions appear here the moment they happen."
        />
      ) : (
        <div className="rounded-lg border bg-card shadow-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Entity</TableHead>
                <TableHead>IP</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                    {formatIstDateTime(r.createdAt)}
                  </TableCell>
                  <TableCell className="text-sm">
                    {r.actorName ? (
                      <>
                        <span className="font-medium">{r.actorName}</span>
                        <span className="block text-xs text-muted-foreground">{r.actorEmail}</span>
                      </>
                    ) : (
                      <span className="text-muted-foreground">System</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="font-mono">
                      {r.action}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm">
                    <span className="font-medium">{r.entityType}</span>
                    <span className="block font-mono text-xs text-muted-foreground">{r.entityId}</span>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{r.ip ?? "—"}</TableCell>
                  <TableCell>
                    {hasDetails(r) ? (
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button variant="ghost" size="icon" aria-label="Details">
                            <Info className="size-4" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent align="end" className="w-96">
                          {r.reason ? (
                            <p className="mb-2 text-sm">
                              <span className="font-medium">Reason:</span> {r.reason}
                            </p>
                          ) : null}
                          {r.before ? (
                            <Detail label="Before" value={r.before} />
                          ) : null}
                          {r.after ? <Detail label="After" value={r.after} /> : null}
                        </PopoverContent>
                      </Popover>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {cursor ? (
        <div className="flex justify-center">
          <Button variant="outline" onClick={loadMore} disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            Load more
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="mt-1">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <pre className="mt-1 max-h-40 overflow-auto rounded-md bg-muted p-2 text-xs">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}
