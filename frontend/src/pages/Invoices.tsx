import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlarmClock, CircleDollarSign, Receipt, Search } from "lucide-react";
import { qk } from "@/lib/api/queries";
import {
  INVOICE_PAYMENT_STATUSES,
  INVOICE_STATUSES,
  listInvoices,
  type InvoiceFilters,
  type InvoiceListItem,
  type InvoicePaymentStatus,
  type InvoiceStatus,
  type InvoiceType,
} from "@/lib/api/invoices";
import { formatDate } from "@/lib/format";
import { humanize, toNumber } from "@/lib/utils";
import { useDebounce } from "@/hooks/useDebounce";
import { PageHeader } from "@/components/PageHeader";
import { StatCard } from "@/components/StatCard";
import { DataTable, type Column, type SortState } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { MoneyText } from "@/components/MoneyText";
import { EmptyState } from "@/components/EmptyState";
import { Badge } from "@/components/ui/badge";
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

/**
 * A cash bill is a legally distinct, Non-GST document — never a tax invoice
 * with the tax rows hidden — so the badge says so in words, not just colour.
 */
const TYPE_LABELS: Record<InvoiceType, string> = {
  tax_invoice: "GST Tax Invoice",
  cash_bill: "Cash Bill · Non-GST",
  proforma: "Proforma",
  credit_note: "Credit Note",
  debit_note: "Debit Note",
};

const TYPE_TABS: { value: InvoiceType | ""; label: string }[] = [
  { value: "", label: "All" },
  { value: "tax_invoice", label: "GST" },
  { value: "cash_bill", label: "Cash Bill" },
];

function InvoiceTypeBadge({ type }: { type: InvoiceType }) {
  if (type === "cash_bill") {
    return <Badge variant="status" className="bg-status-pending-bg text-status-pending">{TYPE_LABELS.cash_bill}</Badge>;
  }
  if (type === "tax_invoice") {
    return <Badge variant="status" className="bg-status-confirmed-bg text-status-confirmed">{TYPE_LABELS.tax_invoice}</Badge>;
  }
  return <Badge variant="outline">{TYPE_LABELS[type]}</Badge>;
}

export default function Invoices() {
  const navigate = useNavigate();

  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search);
  const [status, setStatus] = useState<InvoiceStatus | "">("");
  const [paymentStatus, setPaymentStatus] = useState<InvoicePaymentStatus | "">("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [overdueOnly, setOverdueOnly] = useState(false);
  // Not a server filter — the fetched page is narrowed below.
  const [invoiceType, setInvoiceType] = useState<InvoiceType | "">("");
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<SortState | undefined>(undefined);

  const filters: InvoiceFilters = useMemo(
    () => ({
      page,
      limit: 25,
      search: debouncedSearch || undefined,
      status: status || undefined,
      payment_status: paymentStatus || undefined,
      from: from || undefined,
      to: to || undefined,
      overdue: overdueOnly || undefined,
      sort: sort?.key,
      dir: sort?.direction,
    }),
    [page, debouncedSearch, status, paymentStatus, from, to, overdueOnly, sort],
  );

  const listQuery = useQuery({ queryKey: qk.invoices.list(filters), queryFn: () => listInvoices(filters) });

  const unpaidQuery = useQuery({
    queryKey: qk.invoices.list({ payment_status: "unpaid", limit: 1 }),
    queryFn: () => listInvoices({ payment_status: "unpaid", limit: 1 }),
  });
  const partQuery = useQuery({
    queryKey: qk.invoices.list({ payment_status: "partially_paid", limit: 1 }),
    queryFn: () => listInvoices({ payment_status: "partially_paid", limit: 1 }),
  });
  const overdueQuery = useQuery({
    queryKey: qk.invoices.list({ overdue: true, limit: 1 }),
    queryFn: () => listInvoices({ overdue: true, limit: 1 }),
  });

  const rows = useMemo(() => {
    const items = listQuery.data?.items ?? [];
    return invoiceType === "" ? items : items.filter((row) => row.invoice_type === invoiceType);
  }, [listQuery.data, invoiceType]);

  const columns: Column<InvoiceListItem>[] = [
    {
      key: "invoice_no",
      header: "Invoice",
      sortable: true,
      render: (row) => (
        <div>
          <p className="font-medium">{row.invoice_no}</p>
          <p className="text-xs text-muted-foreground">{row.booking_no ?? "No booking"} · {humanize(row.status)}</p>
        </div>
      ),
    },
    {
      key: "customer_name",
      header: "Customer",
      render: (row) => (
        <div>
          <p>{row.customer_name ?? "—"}</p>
          {row.customer_phone && <p className="text-xs text-muted-foreground">{row.customer_phone}</p>}
        </div>
      ),
    },
    {
      key: "invoice_type",
      header: "Type",
      render: (row) => <InvoiceTypeBadge type={row.invoice_type} />,
      hideOnMobile: true,
    },
    {
      key: "invoice_date",
      header: "Dated",
      sortable: true,
      render: (row) => (
        <div>
          <p>{formatDate(row.invoice_date)}</p>
          {row.due_date && <p className="text-xs text-muted-foreground">Due {formatDate(row.due_date)}</p>}
        </div>
      ),
    },
    {
      key: "grand_total",
      header: "Total",
      align: "right",
      sortable: true,
      render: (row) => <MoneyText value={row.grand_total} struck={row.status === "void"} />,
    },
    {
      key: "outstanding",
      header: "Outstanding",
      align: "right",
      render: (row) => (
        <MoneyText value={row.outstanding} className={toNumber(row.outstanding) > 0 ? "text-status-overdue" : undefined} />
      ),
    },
    {
      key: "payment_status",
      header: "Payment",
      render: (row) => <StatusBadge status={row.payment_status} size="sm" />,
    },
    {
      key: "days_overdue",
      header: "Overdue",
      align: "right",
      render: (row) =>
        row.days_overdue !== null && row.days_overdue > 0 ? (
          <span className="tabular text-status-overdue">{row.days_overdue}d</span>
        ) : (
          "—"
        ),
      hideOnMobile: true,
    },
  ];

  const hasFilters =
    search !== "" || status !== "" || paymentStatus !== "" || from !== "" || to !== "" || overdueOnly || invoiceType !== "";

  return (
    <div className="space-y-5">
      <PageHeader
        title="Invoices"
        description="GST tax invoices and Non-GST cash bills. Raise a new one from its booking."
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Unpaid" value={unpaidQuery.data?.pagination.total ?? 0} icon={Receipt} tone="warning" loading={unpaidQuery.isLoading} />
        <StatCard label="Part paid" value={partQuery.data?.pagination.total ?? 0} icon={CircleDollarSign} tone="info" loading={partQuery.isLoading} />
        <StatCard label="Overdue" value={overdueQuery.data?.pagination.total ?? 0} icon={AlarmClock} tone="negative" loading={overdueQuery.isLoading} />
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <div className="relative min-w-[220px] flex-1">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search invoice no, customer…" className="pl-8" />
          </div>

          <div className="inline-flex rounded-lg border p-1">
            {TYPE_TABS.map((tab) => (
              <Button
                key={tab.value || "all"}
                type="button"
                size="sm"
                variant={invoiceType === tab.value ? "default" : "ghost"}
                onClick={() => setInvoiceType(tab.value)}
              >
                {tab.label}
              </Button>
            ))}
          </div>

          <Select value={status || "__all__"} onValueChange={(v) => { setStatus(v === "__all__" ? "" : (v as InvoiceStatus)); setPage(1); }}>
            <SelectTrigger className="w-36"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All statuses</SelectItem>
              {INVOICE_STATUSES.map((s) => <SelectItem key={s} value={s}>{humanize(s)}</SelectItem>)}
            </SelectContent>
          </Select>

          <Select value={paymentStatus || "__all__"} onValueChange={(v) => { setPaymentStatus(v === "__all__" ? "" : (v as InvoicePaymentStatus)); setPage(1); }}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Payment" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Any payment status</SelectItem>
              {INVOICE_PAYMENT_STATUSES.map((s) => <SelectItem key={s} value={s}>{humanize(s)}</SelectItem>)}
            </SelectContent>
          </Select>

          <div className="flex items-center gap-1.5">
            <Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} className="w-36" aria-label="Invoiced from" />
            <span className="text-muted-foreground">–</span>
            <Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} className="w-36" aria-label="Invoiced to" />
          </div>

          <Button type="button" variant={overdueOnly ? "default" : "outline"} size="sm" onClick={() => { setOverdueOnly((v) => !v); setPage(1); }}>
            Overdue only
          </Button>

          {hasFilters && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearch(""); setStatus(""); setPaymentStatus(""); setFrom(""); setTo("");
                setOverdueOnly(false); setInvoiceType(""); setPage(1);
              }}
            >
              Clear filters
            </Button>
          )}
        </CardContent>
      </Card>

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        loading={listQuery.isLoading}
        empty={
          <EmptyState
            title="No invoices"
            description={
              invoiceType === ""
                ? "Invoices are raised from a confirmed booking."
                : `No ${TYPE_LABELS[invoiceType]} documents on this page.`
            }
          />
        }
        onRowClick={(row) => navigate(`/invoices/${row.id}`)}
        sort={sort}
        onSortChange={(s) => { setSort(s); setPage(1); }}
        pagination={listQuery.data?.pagination}
        onPageChange={setPage}
        rowClassName={(row) => (row.status === "void" || row.status === "cancelled" ? "opacity-60" : undefined)}
      />
    </div>
  );
}
