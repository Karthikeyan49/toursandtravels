import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CalendarClock, FileText, PlaneLanding, Wallet } from "lucide-react";
import { qk } from "@/lib/api/queries";
import {
  getOutstandingReport,
  type OutstandingBookingRow,
  type OutstandingBucket,
  type OutstandingFilters,
  type OutstandingInvoiceRow,
} from "@/lib/api/reports";
import { formatDate, formatMoneyShort, formatNumber } from "@/lib/format";
import { toNumber } from "@/lib/utils";
import { StatCard } from "@/components/StatCard";
import { DataTable, type Column } from "@/components/DataTable";
import { MoneyText } from "@/components/MoneyText";
import { StatusBadge } from "@/components/StatusBadge";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CustomerSelect, ExportButton, FilterBar, OwnerSelect, TotalCell, type ExportParams } from "@/pages/reports/shared";

/**
 * Money still to come in, split by how urgent it is. The buckets come from the
 * API (`bucket` on each row); the tabs here only filter what is already there,
 * so the totals strip and the table can never disagree.
 */

const BUCKETS: readonly { value: OutstandingBucket; label: string; className: string }[] = [
  { value: "departed", label: "Already departed", className: "text-status-overdue" },
  { value: "due_now", label: "Due now", className: "text-status-pending" },
  { value: "due_30", label: "Due in 30 days", className: "text-status-in-progress" },
  { value: "later", label: "Later", className: "text-muted-foreground" },
];

const ALL_BUCKETS = "all";

export function OutstandingTab({ active }: { active: boolean }) {
  const navigate = useNavigate();

  const [customerId, setCustomerId] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [bucket, setBucket] = useState<OutstandingBucket | typeof ALL_BUCKETS>(ALL_BUCKETS);

  const filters: OutstandingFilters = useMemo(
    () => ({
      customer_id: customerId ? Number(customerId) : undefined,
      owner_id: ownerId ? Number(ownerId) : undefined,
      overdue_only: overdueOnly || undefined,
    }),
    [customerId, ownerId, overdueOnly],
  );

  const exportParams: ExportParams = useMemo(() => ({ ...filters }), [filters]);

  const reportQuery = useQuery({
    // `qk.reports.outstanding` is a fixed key; the filters are appended so a
    // filter change refetches instead of reusing another filter's rows.
    queryKey: [...qk.reports.outstanding, filters],
    queryFn: () => getOutstandingReport(filters),
    enabled: active,
  });

  const report = reportQuery.data;

  const rows = useMemo(() => {
    const all = report?.rows ?? [];
    return bucket === ALL_BUCKETS ? all : all.filter((row) => row.bucket === bucket);
  }, [report, bucket]);

  const bucketTotal = useMemo(() => {
    if (!report) return 0;
    if (bucket === ALL_BUCKETS) return toNumber(report.totals.outstanding);
    return toNumber(report.buckets[bucket]);
  }, [report, bucket]);

  const bookingColumns: Column<OutstandingBookingRow>[] = [
    {
      key: "booking_no",
      header: "Booking",
      render: (row) => (
        <div>
          <p className="font-medium">{row.booking_no}</p>
          <p className="text-xs text-muted-foreground">
            {row.customer_name ?? "—"}
            {row.customer_phone ? ` · ${row.customer_phone}` : ""}
          </p>
        </div>
      ),
    },
    {
      key: "destination_name",
      header: "Destination",
      render: (row) => row.destination_name ?? "—",
      hideOnMobile: true,
    },
    {
      key: "travel_from",
      header: "Departs",
      render: (row) => (
        <div>
          <p>{formatDate(row.travel_from)}</p>
          <p className="text-xs text-muted-foreground">
            {row.days_to_departure < 0 ? `departed ${Math.abs(row.days_to_departure)}d ago` : `${row.days_to_departure}d away`}
          </p>
        </div>
      ),
    },
    {
      key: "next_instalment_due",
      header: "Next instalment",
      render: (row) => (
        <div>
          <p>{row.next_instalment_due ? formatDate(row.next_instalment_due) : "—"}</p>
          <p className="text-xs text-muted-foreground">
            {row.last_payment_at ? `last paid ${formatDate(row.last_payment_at)}` : "no payment yet"}
          </p>
        </div>
      ),
      hideOnMobile: true,
    },
    {
      key: "grand_total",
      header: "Invoiced",
      align: "right",
      render: (row) => (
        <div>
          <MoneyText value={row.grand_total} />
          <p className="text-xs text-muted-foreground">
            paid {formatMoneyShort(row.amount_paid)}
          </p>
        </div>
      ),
      hideOnMobile: true,
    },
    {
      key: "outstanding",
      header: "Outstanding",
      align: "right",
      render: (row) => <MoneyText value={row.outstanding} className="font-medium text-status-overdue" />,
    },
    {
      key: "bucket",
      header: "Bucket",
      render: (row) => {
        const meta = BUCKETS.find((b) => b.value === row.bucket);
        return <span className={`text-xs font-medium ${meta?.className ?? ""}`}>{meta?.label ?? row.bucket}</span>;
      },
      hideOnMobile: true,
    },
    {
      key: "payment_status",
      header: "Payment",
      render: (row) => <StatusBadge status={row.payment_status} size="sm" />,
    },
    {
      key: "owner_name",
      header: "Owner",
      render: (row) => row.owner_name ?? "—",
      hideOnMobile: true,
    },
  ];

  const invoiceColumns: Column<OutstandingInvoiceRow>[] = [
    {
      key: "invoice_no",
      header: "Invoice",
      render: (row) => (
        <div>
          <p className="font-medium">{row.invoice_no}</p>
          <p className="text-xs text-muted-foreground">{row.customer_name ?? "—"}</p>
        </div>
      ),
    },
    { key: "invoice_date", header: "Raised", render: (row) => formatDate(row.invoice_date), hideOnMobile: true },
    {
      key: "due_date",
      header: "Due",
      render: (row) => (
        <div>
          <p>{row.due_date ? formatDate(row.due_date) : "—"}</p>
          {row.days_overdue !== null && row.days_overdue > 0 && (
            <p className="text-xs font-medium text-status-overdue">{row.days_overdue}d overdue</p>
          )}
        </div>
      ),
    },
    {
      key: "grand_total",
      header: "Invoiced",
      align: "right",
      render: (row) => <MoneyText value={row.grand_total} />,
      hideOnMobile: true,
    },
    {
      key: "amount_paid",
      header: "Paid",
      align: "right",
      render: (row) => <MoneyText value={row.amount_paid} muted />,
      hideOnMobile: true,
    },
    {
      key: "outstanding",
      header: "Outstanding",
      align: "right",
      render: (row) => <MoneyText value={row.outstanding} className="font-medium text-status-overdue" />,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Total outstanding"
          value={report ? <MoneyText value={report.totals.outstanding} short /> : "—"}
          icon={Wallet}
          tone="warning"
          hint={report ? `${formatNumber(report.totals.booking_count)} booking(s)` : undefined}
          loading={reportQuery.isLoading}
        />
        <StatCard
          label="Already departed"
          value={report ? <MoneyText value={report.buckets.departed} short /> : "—"}
          icon={PlaneLanding}
          tone="negative"
          hint="travelled without paying in full"
          loading={reportQuery.isLoading}
        />
        <StatCard
          label="Due now"
          value={report ? <MoneyText value={report.buckets.due_now} short /> : "—"}
          icon={CalendarClock}
          tone="warning"
          hint={report ? `balance due ${report.balance_due_days_before}d before travel` : undefined}
          loading={reportQuery.isLoading}
        />
        <StatCard
          label="Unpaid invoices"
          value={report ? <MoneyText value={report.invoices.reduce((sum, i) => sum + toNumber(i.outstanding), 0)} short /> : "—"}
          icon={FileText}
          tone="info"
          hint={report ? `${formatNumber(report.invoices.length)} invoice(s)` : undefined}
          loading={reportQuery.isLoading}
        />
      </div>

      <FilterBar>
        <CustomerSelect value={customerId} onChange={setCustomerId} />
        <OwnerSelect value={ownerId} onChange={setOwnerId} />
        <Button
          type="button"
          variant={overdueOnly ? "default" : "outline"}
          size="sm"
          onClick={() => setOverdueOnly((v) => !v)}
        >
          Overdue only
        </Button>

        <div className="ml-auto">
          <ExportButton slug="outstanding" params={exportParams} />
        </div>
      </FilterBar>

      <Tabs value={bucket} onValueChange={(v) => setBucket(v === ALL_BUCKETS ? ALL_BUCKETS : (v as OutstandingBucket))}>
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value={ALL_BUCKETS}>
            All
            {report && <span className="ml-1.5 tabular text-xs">{formatMoneyShort(report.totals.outstanding)}</span>}
          </TabsTrigger>
          {BUCKETS.map((b) => (
            <TabsTrigger key={b.value} value={b.value}>
              <span className={b.className}>{b.label}</span>
              {report && <span className="ml-1.5 tabular text-xs">{formatMoneyShort(report.buckets[b.value])}</span>}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <DataTable
        columns={bookingColumns}
        rows={rows}
        rowKey={(row) => row.id}
        loading={reportQuery.isLoading}
        onRowClick={(row) => navigate(`/bookings/${row.id}`)}
        ariaLabel="Bookings with a balance due"
        empty={
          <EmptyState
            title="Nothing outstanding here"
            description="No booking in this bucket has a balance due."
          />
        }
        rowClassName={(row) => (row.bucket === "departed" ? "bg-status-overdue-bg/40" : undefined)}
        footer={
          <>
            <TotalCell align="left">{formatNumber(rows.length)} booking(s)</TotalCell>
            <TotalCell align="left" hideOnMobile />
            <TotalCell align="left" />
            <TotalCell align="left" hideOnMobile />
            <TotalCell hideOnMobile />
            <TotalCell>
              <MoneyText value={bucketTotal} />
            </TotalCell>
            <TotalCell align="left" hideOnMobile />
            <TotalCell align="left" />
            <TotalCell align="left" hideOnMobile />
          </>
        }
      />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Unpaid invoices</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={invoiceColumns}
            rows={report?.invoices ?? []}
            rowKey={(row) => row.id}
            loading={reportQuery.isLoading}
            ariaLabel="Invoices with a balance due"
            empty={<EmptyState compact title="Every invoice is settled" />}
            rowClassName={(row) => (row.days_overdue !== null && row.days_overdue > 0 ? "bg-status-overdue-bg/40" : undefined)}
          />
        </CardContent>
      </Card>
    </div>
  );
}
