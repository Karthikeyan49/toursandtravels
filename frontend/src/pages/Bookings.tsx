import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CalendarRange, PlaneTakeoff, Search, Wallet } from "lucide-react";
import { qk } from "@/lib/api/queries";
import {
  BOOKING_PAYMENT_STATUSES,
  BOOKING_STATUSES,
  listBookings,
  type BookingFilters,
  type BookingListItem,
  type BookingPaymentStatus,
  type BookingStatus,
} from "@/lib/api/bookings";
import { listDestinationOptions } from "@/lib/api/destinations";
import { listUsers } from "@/lib/api/users";
import { formatDate, formatPax } from "@/lib/format";
import { humanize } from "@/lib/utils";
import { useDebounce } from "@/hooks/useDebounce";
import { PageHeader } from "@/components/PageHeader";
import { StatCard } from "@/components/StatCard";
import { DataTable, type Column, type SortState } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { MoneyText } from "@/components/MoneyText";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const STATUS_LABELS: Record<BookingStatus, string> = {
  draft: "Draft",
  confirmed: "Confirmed",
  vouchered: "Vouchered",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
  no_show: "No show",
};

const PAYMENT_LABELS: Record<BookingPaymentStatus, string> = {
  unpaid: "Unpaid",
  advance_paid: "Advance paid",
  partially_paid: "Part paid",
  paid: "Paid",
  refunded: "Refunded",
  overpaid: "Overpaid",
};

export default function Bookings() {
  const navigate = useNavigate();

  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search);
  const [status, setStatus] = useState<BookingStatus | "">("");
  const [paymentStatus, setPaymentStatus] = useState<BookingPaymentStatus | "">("");
  const [destinationId, setDestinationId] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [travelFrom, setTravelFrom] = useState("");
  const [travelTo, setTravelTo] = useState("");
  const [outstandingOnly, setOutstandingOnly] = useState(false);
  const [departingWithinDays, setDepartingWithinDays] = useState<number | "">("");
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<SortState | undefined>(undefined);

  const filters: BookingFilters = useMemo(
    () => ({
      page,
      limit: 25,
      search: debouncedSearch || undefined,
      status: status || undefined,
      payment_status: paymentStatus || undefined,
      destination_id: destinationId ? Number(destinationId) : undefined,
      owner_id: ownerId ? Number(ownerId) : undefined,
      travel_from: travelFrom || undefined,
      travel_to: travelTo || undefined,
      outstanding_only: outstandingOnly || undefined,
      departing_within_days: departingWithinDays === "" ? undefined : departingWithinDays,
      sort: sort?.key,
      dir: sort?.direction,
    }),
    [page, debouncedSearch, status, paymentStatus, destinationId, ownerId, travelFrom, travelTo, outstandingOnly, departingWithinDays, sort],
  );

  const listQuery = useQuery({ queryKey: qk.bookings.list(filters), queryFn: () => listBookings(filters) });

  const confirmedQuery = useQuery({
    queryKey: qk.bookings.list({ status: "confirmed", limit: 1 }),
    queryFn: () => listBookings({ status: "confirmed", limit: 1 }),
  });
  const outstandingQuery = useQuery({
    queryKey: qk.bookings.list({ outstanding_only: true, limit: 1 }),
    queryFn: () => listBookings({ outstanding_only: true, limit: 1 }),
  });
  const departingQuery = useQuery({
    queryKey: qk.bookings.list({ departing_within_days: 7, limit: 1 }),
    queryFn: () => listBookings({ departing_within_days: 7, limit: 1 }),
  });

  const destinationsQuery = useQuery({ queryKey: qk.destinations.options, queryFn: listDestinationOptions });
  const usersQuery = useQuery({ queryKey: qk.users.list({ is_active: true, limit: 200 }), queryFn: () => listUsers({ is_active: true, limit: 200 }) });

  const columns: Column<BookingListItem>[] = [
    {
      key: "booking_no",
      header: "Booking",
      render: (row) => (
        <div>
          <p className="font-medium">{row.booking_no}</p>
          <p className="text-xs text-muted-foreground">{row.customer_name ?? "—"} · {row.customer_phone ?? ""}</p>
        </div>
      ),
    },
    {
      key: "destination_name",
      header: "Destination",
      render: (row) => (
        <div>
          <p>{row.destination_name ?? "—"}</p>
          {row.package_name && <p className="text-xs text-muted-foreground">{row.package_name}</p>}
        </div>
      ),
      hideOnMobile: true,
    },
    {
      key: "travel_from",
      header: "Travel",
      render: (row) => (
        <div>
          <p>{formatDate(row.travel_from)} – {formatDate(row.travel_to)}</p>
          <p className="text-xs text-muted-foreground">{formatPax(row.adults, row.children, row.infants)}</p>
        </div>
      ),
    },
    {
      key: "grand_total",
      header: "Amount",
      align: "right",
      render: (row) => (
        <div>
          <MoneyText value={row.grand_total} />
          {Number(row.outstanding) > 0 && <p className="text-xs"><MoneyText value={row.outstanding} className="text-status-overdue" /> due</p>}
        </div>
      ),
    },
    {
      key: "payment_status",
      header: "Payment",
      render: (row) => <StatusBadge status={row.payment_status} label={PAYMENT_LABELS[row.payment_status]} size="sm" />,
      hideOnMobile: true,
    },
    {
      key: "status",
      header: "Status",
      sortable: true,
      render: (row) => <StatusBadge status={row.status} label={STATUS_LABELS[row.status]} />,
    },
    {
      key: "owner_name",
      header: "Owner",
      render: (row) => row.owner_name ?? "—",
      hideOnMobile: true,
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader title="Bookings" description="Confirmed trips, payments and operations." />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Confirmed bookings" value={confirmedQuery.data?.pagination.total ?? 0} icon={CalendarRange} tone="positive" loading={confirmedQuery.isLoading} />
        <StatCard label="With balance due" value={outstandingQuery.data?.pagination.total ?? 0} icon={Wallet} tone="warning" loading={outstandingQuery.isLoading} />
        <StatCard label="Departing in 7 days" value={departingQuery.data?.pagination.total ?? 0} icon={PlaneTakeoff} tone="info" loading={departingQuery.isLoading} />
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <div className="relative min-w-[220px] flex-1">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search booking no, customer…" className="pl-8" />
          </div>

          <Select value={status || "__all__"} onValueChange={(v) => { setStatus(v === "__all__" ? "" : (v as BookingStatus)); setPage(1); }}>
            <SelectTrigger className="w-36"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All statuses</SelectItem>
              {BOOKING_STATUSES.map((s) => <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>)}
            </SelectContent>
          </Select>

          <Select value={paymentStatus || "__all__"} onValueChange={(v) => { setPaymentStatus(v === "__all__" ? "" : (v as BookingPaymentStatus)); setPage(1); }}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Payment" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Any payment status</SelectItem>
              {BOOKING_PAYMENT_STATUSES.map((s) => <SelectItem key={s} value={s}>{PAYMENT_LABELS[s]}</SelectItem>)}
            </SelectContent>
          </Select>

          <Select value={destinationId || "__all__"} onValueChange={(v) => { setDestinationId(v === "__all__" ? "" : v); setPage(1); }}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Destination" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All destinations</SelectItem>
              {(destinationsQuery.data ?? []).map((d) => <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>)}
            </SelectContent>
          </Select>

          <Select value={ownerId || "__all__"} onValueChange={(v) => { setOwnerId(v === "__all__" ? "" : v); setPage(1); }}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Owner" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Everyone</SelectItem>
              {(usersQuery.data?.items ?? []).map((u) => <SelectItem key={u.id} value={String(u.id)}>{u.full_name}</SelectItem>)}
            </SelectContent>
          </Select>

          <div className="flex items-center gap-1.5">
            <Input type="date" value={travelFrom} onChange={(e) => { setTravelFrom(e.target.value); setPage(1); }} className="w-36" aria-label="Travel from" />
            <span className="text-muted-foreground">–</span>
            <Input type="date" value={travelTo} onChange={(e) => { setTravelTo(e.target.value); setPage(1); }} className="w-36" aria-label="Travel to" />
          </div>

          <Select
            value={departingWithinDays === "" ? "__any__" : String(departingWithinDays)}
            onValueChange={(v) => { setDepartingWithinDays(v === "__any__" ? "" : Number(v)); setPage(1); }}
          >
            <SelectTrigger className="w-40"><SelectValue placeholder="Departing within" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__any__">Any time</SelectItem>
              <SelectItem value="7">Within 7 days</SelectItem>
              <SelectItem value="14">Within 14 days</SelectItem>
              <SelectItem value="30">Within 30 days</SelectItem>
            </SelectContent>
          </Select>

          <Button type="button" variant={outstandingOnly ? "default" : "outline"} size="sm" onClick={() => { setOutstandingOnly((v) => !v); setPage(1); }}>
            Outstanding only
          </Button>

          {(status || paymentStatus || destinationId || ownerId || travelFrom || travelTo || outstandingOnly || departingWithinDays !== "" || search) && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearch(""); setStatus(""); setPaymentStatus(""); setDestinationId(""); setOwnerId("");
                setTravelFrom(""); setTravelTo(""); setOutstandingOnly(false); setDepartingWithinDays(""); setPage(1);
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
        onRowClick={(row) => navigate(`/bookings/${row.id}`)}
        sort={sort}
        onSortChange={(s) => { setSort(s); setPage(1); }}
        pagination={listQuery.data?.pagination}
        onPageChange={setPage}
        rowClassName={(row) => (row.status === "cancelled" ? "opacity-60" : undefined)}
      />
    </div>
  );
}
