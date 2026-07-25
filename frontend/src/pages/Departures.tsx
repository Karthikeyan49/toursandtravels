import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { qk } from "@/lib/api/queries";
import { DEPARTURE_STATUSES, listDepartures, type DepartureBoardRow, type DepartureFilters, type DepartureStatus } from "@/lib/api/packages";
import { formatDate } from "@/lib/format";
import { humanize } from "@/lib/utils";
import { useDebounce } from "@/hooks/useDebounce";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, type Column } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

function fillTone(pct: number): string {
  if (pct >= 90) return "text-status-overdue";
  if (pct >= 60) return "text-status-pending";
  return "text-status-paid";
}

export default function Departures() {
  const navigate = useNavigate();

  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search);
  const [status, setStatus] = useState<DepartureStatus | "">("");
  const [availableOnly, setAvailableOnly] = useState(false);
  const [page, setPage] = useState(1);

  const filters: DepartureFilters = useMemo(
    () => ({ page, limit: 25, status: status || undefined, available_only: availableOnly || undefined }),
    [page, status, availableOnly],
  );

  const listQuery = useQuery({ queryKey: qk.departures.list(filters), queryFn: () => listDepartures(filters) });

  const rows = useMemo(() => {
    const items = listQuery.data?.items ?? [];
    if (!debouncedSearch) return items;
    const needle = debouncedSearch.toLowerCase();
    return items.filter(
      (r) => r.package_name.toLowerCase().includes(needle) || r.batch_code.toLowerCase().includes(needle) || r.package_code.toLowerCase().includes(needle),
    );
  }, [listQuery.data, debouncedSearch]);

  const columns: Column<DepartureBoardRow>[] = [
    {
      key: "package_name",
      header: "Package",
      render: (row) => (
        <div>
          <p className="font-medium">{row.package_name}</p>
          <p className="text-xs text-muted-foreground">{row.package_code} · {row.destination_name ?? "—"}</p>
        </div>
      ),
    },
    { key: "batch_code", header: "Batch" },
    {
      key: "departure_date",
      header: "Departs",
      sortable: false,
      render: (row) => (
        <div>
          <p>{formatDate(row.departure_date)}</p>
          <p className="text-xs text-muted-foreground">
            {row.days_to_departure >= 0 ? `${row.days_to_departure}d away` : "Departed"}
          </p>
        </div>
      ),
    },
    {
      key: "fill_pct",
      header: "Seats",
      render: (row) => {
        const pct = Number(row.fill_pct ?? 0);
        return (
          <div className="w-32">
            <div className="flex items-center justify-between text-xs">
              <span>{row.seats_booked}/{row.seats_total}</span>
              <span className={fillTone(pct)}>{pct.toFixed(0)}%</span>
            </div>
            <Progress value={pct} className="mt-1 h-1.5" />
          </div>
        );
      },
    },
    { key: "tour_manager_name", header: "Tour manager", render: (row) => row.tour_manager_name ?? "—", hideOnMobile: true },
    { key: "status", header: "Status", render: (row) => <StatusBadge status={row.status} /> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader title="Departures" description="Every fixed-departure batch across all packages, with seat-fill at a glance." />

      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <div className="relative min-w-[220px] flex-1">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search package or batch code…" className="pl-8" />
          </div>
          <Select value={status || "__all__"} onValueChange={(v) => { setStatus(v === "__all__" ? "" : (v as DepartureStatus)); setPage(1); }}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All statuses</SelectItem>
              {DEPARTURE_STATUSES.map((s) => <SelectItem key={s} value={s}>{humanize(s)}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant={availableOnly ? "default" : "outline"}
            size="sm"
            onClick={() => { setAvailableOnly((v) => !v); setPage(1); }}
          >
            Seats available only
          </Button>
        </CardContent>
      </Card>

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        loading={listQuery.isLoading}
        onRowClick={(row) => navigate(`/packages/${row.package_id}`)}
        pagination={listQuery.data?.pagination}
        onPageChange={setPage}
      />
    </div>
  );
}
