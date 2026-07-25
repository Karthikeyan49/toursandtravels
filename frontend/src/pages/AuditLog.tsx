import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Search } from "lucide-react";
import { qk } from "@/lib/api/queries";
import {
  listAuditLog,
  parseAuditValue,
  type AuditLogEntry,
  type AuditLogFilters,
} from "@/lib/api/auditLog";
import { listUsers } from "@/lib/api/users";
import { formatDateTime, relativeTime } from "@/lib/format";
import { humanize } from "@/lib/utils";
import { useDebounce } from "@/hooks/useDebounce";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, type Column } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

/** Entity types the API's Audit::log calls actually write. */
const ENTITY_TYPES = [
  "activity",
  "booking",
  "booking_service",
  "customer",
  "destination",
  "expense",
  "hotel",
  "hotel_rate",
  "invoice",
  "lead",
  "ops_daysheet",
  "package",
  "quotation",
  "settings",
  "supplier",
  "supplier_bill",
  "trip_assignment",
  "user",
] as const;

/** Only the entity types with an unambiguous detail route are linkable. */
const ENTITY_ROUTES: Record<string, string> = {
  booking: "/bookings",
  lead: "/leads",
  quotation: "/quotations",
  customer: "/customers",
  package: "/packages",
  supplier: "/suppliers",
  invoice: "/invoices",
};

function entityLink(entry: AuditLogEntry): string | null {
  if (!entry.entity_type || entry.entity_id === null) return null;
  const base = ENTITY_ROUTES[entry.entity_type];
  return base ? `${base}/${entry.entity_id}` : null;
}

/** Union of the keys present in either snapshot — both may be null on old rows. */
function diffKeys(entry: AuditLogEntry): string[] {
  const before = parseAuditValue(entry.old_value);
  const after = parseAuditValue(entry.new_value);
  return [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])];
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value === "" ? "—" : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function AuditDetailSheet({ entry, onOpenChange }: { entry: AuditLogEntry | null; onOpenChange: (open: boolean) => void }) {
  const before = entry ? parseAuditValue(entry.old_value) : null;
  const after = entry ? parseAuditValue(entry.new_value) : null;
  const keys = entry ? diffKeys(entry) : [];

  return (
    <Sheet open={entry !== null} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{entry ? humanize(entry.action) : "Audit entry"}</SheetTitle>
          <SheetDescription>
            {entry?.entity_type
              ? `${humanize(entry.entity_type)}${entry.entity_id !== null ? ` #${entry.entity_id}` : ""}`
              : "No entity recorded"}
          </SheetDescription>
        </SheetHeader>

        {entry && (
          <div className="space-y-5">
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">When</dt>
                <dd>{formatDateTime(entry.created_at)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">User</dt>
                <dd>{entry.actor_name ?? "System"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Role</dt>
                <dd>{entry.actor_role ? humanize(entry.actor_role) : "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">IP address</dt>
                <dd className="font-mono text-xs">{entry.ip_address ?? "—"}</dd>
              </div>
              {entry.note && (
                <div className="col-span-2">
                  <dt className="text-xs text-muted-foreground">Note</dt>
                  <dd>{entry.note}</dd>
                </div>
              )}
            </dl>

            <Separator />

            <div>
              <h3 className="mb-2 text-sm font-medium">Before / after</h3>
              {keys.length === 0 ? (
                <EmptyState
                  compact
                  title="No field snapshot"
                  description="This entry records the action only — older rows predate the value snapshots."
                />
              ) : (
                <div className="space-y-1.5">
                  {keys.map((key) => {
                    const oldValue = before ? before[key] : undefined;
                    const newValue = after ? after[key] : undefined;
                    const changed = displayValue(oldValue) !== displayValue(newValue);

                    return (
                      <div key={key} className="rounded-md border px-3 py-2 text-sm">
                        <p className="text-xs font-medium text-muted-foreground">{humanize(key)}</p>
                        <div className="mt-1 grid grid-cols-2 gap-3">
                          <p className={changed ? "text-status-cancelled line-through" : "text-muted-foreground"}>
                            {displayValue(oldValue)}
                          </p>
                          <p className={changed ? "font-medium text-status-confirmed" : "text-muted-foreground"}>
                            {displayValue(newValue)}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

export default function AuditLog() {
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search);
  const [action, setAction] = useState("");
  const debouncedAction = useDebounce(action);
  const [entityType, setEntityType] = useState("");
  const [entityId, setEntityId] = useState("");
  const debouncedEntityId = useDebounce(entityId);
  const [userId, setUserId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<AuditLogEntry | null>(null);

  const filters: AuditLogFilters = useMemo(
    () => ({
      page,
      limit: 50,
      search: debouncedSearch || undefined,
      action: debouncedAction || undefined,
      entity_type: entityType || undefined,
      entity_id: debouncedEntityId ? Number(debouncedEntityId) : undefined,
      user_id: userId ? Number(userId) : undefined,
      from: from || undefined,
      to: to || undefined,
    }),
    [page, debouncedSearch, debouncedAction, entityType, debouncedEntityId, userId, from, to],
  );

  const listQuery = useQuery({ queryKey: qk.auditLog.list(filters), queryFn: () => listAuditLog(filters) });

  const usersQuery = useQuery({
    queryKey: qk.users.list({ is_active: true, limit: 200 }),
    queryFn: () => listUsers({ is_active: true, limit: 200 }),
  });

  const columns: Column<AuditLogEntry>[] = [
    {
      key: "created_at",
      header: "When",
      render: (row) => (
        <div>
          <p>{formatDateTime(row.created_at)}</p>
          <p className="text-xs text-muted-foreground">{relativeTime(row.created_at)}</p>
        </div>
      ),
    },
    {
      key: "actor_name",
      header: "User",
      render: (row) => (
        <div className="flex flex-col items-start gap-1">
          <span>{row.actor_name ?? "System"}</span>
          {row.actor_role && <StatusBadge status={row.actor_role} label={humanize(row.actor_role)} size="sm" />}
        </div>
      ),
    },
    { key: "action", header: "Action", render: (row) => humanize(row.action) },
    {
      key: "entity_type",
      header: "Entity",
      render: (row) => {
        if (!row.entity_type) return "—";
        const to = entityLink(row);
        const label = `${humanize(row.entity_type)}${row.entity_id !== null ? ` #${row.entity_id}` : ""}`;
        return to ? (
          <Link
            to={to}
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1 underline-offset-4 hover:underline"
          >
            {label}
            <ExternalLink className="h-3 w-3 opacity-60" aria-hidden />
          </Link>
        ) : (
          label
        );
      },
      hideOnMobile: true,
    },
    {
      key: "changes",
      header: "Changes",
      render: (row) => {
        const keys = diffKeys(row);
        if (keys.length === 0) return <span className="text-muted-foreground">{row.note ?? "—"}</span>;
        const shown = keys.slice(0, 3).map(humanize).join(", ");
        return (
          <span className="text-xs text-muted-foreground">
            {shown}
            {keys.length > 3 ? ` +${keys.length - 3} more` : ""}
          </span>
        );
      },
      hideOnMobile: true,
    },
  ];

  const hasFilters =
    search !== "" || action !== "" || entityType !== "" || entityId !== "" || userId !== "" || from !== "" || to !== "";

  return (
    <div className="space-y-5">
      <PageHeader
        title="Audit log"
        description="Append-only record of every write the API has made — who changed what, and when."
      />

      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <div className="relative min-w-[220px] flex-1">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder="Search note, action or user…"
              className="pl-8"
            />
          </div>

          <Select value={entityType || "__all__"} onValueChange={(v) => { setEntityType(v === "__all__" ? "" : v); setPage(1); }}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Entity" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All entities</SelectItem>
              {ENTITY_TYPES.map((t) => <SelectItem key={t} value={t}>{humanize(t)}</SelectItem>)}
            </SelectContent>
          </Select>

          <Input
            type="number"
            min={1}
            value={entityId}
            onChange={(e) => { setEntityId(e.target.value); setPage(1); }}
            placeholder="Entity id"
            className="w-28"
            aria-label="Entity id"
          />

          <Select value={userId || "__all__"} onValueChange={(v) => { setUserId(v === "__all__" ? "" : v); setPage(1); }}>
            <SelectTrigger className="w-44"><SelectValue placeholder="User" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Everyone</SelectItem>
              {(usersQuery.data?.items ?? []).map((u) => (
                <SelectItem key={u.id} value={String(u.id)}>{u.full_name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Input
            value={action}
            onChange={(e) => { setAction(e.target.value); setPage(1); }}
            placeholder="Action, e.g. update"
            className="w-40"
            aria-label="Action"
          />

          <div className="flex items-center gap-1.5">
            <Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} className="w-36" aria-label="From date" />
            <span className="text-muted-foreground">–</span>
            <Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} className="w-36" aria-label="To date" />
          </div>

          {hasFilters && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearch(""); setAction(""); setEntityType(""); setEntityId(""); setUserId("");
                setFrom(""); setTo(""); setPage(1);
              }}
            >
              Clear filters
            </Button>
          )}
        </CardContent>
      </Card>

      <DataTable
        columns={columns}
        rows={listQuery.data?.items ?? []}
        rowKey={(row) => row.id}
        loading={listQuery.isLoading}
        onRowClick={(row) => setSelected(row)}
        pagination={listQuery.data?.pagination}
        onPageChange={setPage}
        skeletonRows={12}
        empty={<EmptyState title="Nothing logged" description="No audit entry matches the current filters." />}
      />

      <AuditDetailSheet entry={selected} onOpenChange={(open) => { if (!open) setSelected(null); }} />
    </div>
  );
}
