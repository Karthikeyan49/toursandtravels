import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { startOfMonth } from "date-fns";
import { ArrowDownLeft, ArrowUpRight, Scale } from "lucide-react";
import { qk } from "@/lib/api/queries";
import {
  getDaybook,
  PAYMENT_MODES,
  type DaybookEntry,
  type PaymentMode,
} from "@/lib/api/payments";
import { formatDate, toISODate } from "@/lib/format";
import { humanize } from "@/lib/utils";
import { PageHeader } from "@/components/PageHeader";
import { StatCard } from "@/components/StatCard";
import { DataTable, type Column } from "@/components/DataTable";
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

const today = toISODate(new Date()) ?? "";
const monthStart = toISODate(startOfMonth(new Date())) ?? "";

const REF_LABELS: Record<DaybookEntry["ref_type"], string> = {
  booking: "Booking",
  invoice: "Invoice",
  supplier_bill: "Supplier bill",
  commission: "Commission",
  refund: "Refund",
  expense: "Expense",
};

/** Only booking and invoice have a record-level route in this app. */
function refPath(entry: DaybookEntry): string | null {
  if (entry.ref_type === "booking") return `/bookings/${entry.ref_id}`;
  if (entry.ref_type === "invoice") return `/invoices/${entry.ref_id}`;
  return null;
}

function DirectionBadge({ direction }: { direction: DaybookEntry["direction"] }) {
  return (
    <Badge
      variant="status"
      className={direction === "in" ? "bg-status-paid-bg text-status-paid" : "bg-status-overdue-bg text-status-overdue"}
    >
      {direction === "in" ? <ArrowDownLeft className="h-3 w-3" aria-hidden /> : <ArrowUpRight className="h-3 w-3" aria-hidden />}
      {direction === "in" ? "In" : "Out"}
    </Badge>
  );
}

export default function Payments() {
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today);
  const [mode, setMode] = useState<PaymentMode | "">("");

  const daybookQuery = useQuery({
    queryKey: qk.payments.daybook(from, to, mode || undefined),
    queryFn: () => getDaybook({ from: from || undefined, to: to || undefined, mode: mode || undefined }),
  });

  const summary = daybookQuery.data?.summary;
  const byMode = (summary?.by_mode ?? []).filter((row) => row.in !== 0 || row.out !== 0);

  const columns: Column<DaybookEntry>[] = [
    {
      key: "payment_no",
      header: "Payment",
      render: (row) => (
        <div>
          <p className="font-medium">{row.payment_no}</p>
          {row.label && <p className="text-xs text-muted-foreground">{row.label}</p>}
        </div>
      ),
    },
    {
      key: "ref_no",
      header: "Settles",
      render: (row) => {
        const path = refPath(row);
        const label = row.ref_no ?? `#${row.ref_id}`;
        return (
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{REF_LABELS[row.ref_type]}</p>
            {path ? (
              <Link to={path} className="font-medium underline-offset-2 hover:underline">{label}</Link>
            ) : (
              <span className="font-medium">{label}</span>
            )}
          </div>
        );
      },
    },
    {
      key: "direction",
      header: "Direction",
      render: (row) => <DirectionBadge direction={row.direction} />,
    },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      render: (row) => (
        <MoneyText
          value={row.amount}
          className={row.direction === "in" ? "text-status-paid" : "text-status-overdue"}
        />
      ),
    },
    {
      key: "mode",
      header: "Mode",
      render: (row) => (
        <div>
          <p>{humanize(row.mode)}</p>
          {row.utr_no && <p className="text-xs text-muted-foreground">{row.utr_no}</p>}
        </div>
      ),
      hideOnMobile: true,
    },
    { key: "paid_on", header: "Paid on", render: (row) => formatDate(row.paid_on) },
    { key: "remarks", header: "Remarks", render: (row) => row.remarks ?? "—", hideOnMobile: true },
    { key: "recorded_by", header: "Recorded by", render: (row) => row.recorded_by ?? "—", hideOnMobile: true },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Payments daybook"
        description="Every receipt and payout settled in the period. Scheduled instalments live on the booking or invoice they belong to."
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          label="Money in"
          value={<MoneyText value={summary?.total_in ?? 0} short />}
          icon={ArrowDownLeft}
          tone="positive"
          loading={daybookQuery.isLoading}
        />
        <StatCard
          label="Money out"
          value={<MoneyText value={summary?.total_out ?? 0} short />}
          icon={ArrowUpRight}
          tone="negative"
          loading={daybookQuery.isLoading}
        />
        <StatCard
          label="Net"
          value={<MoneyText value={summary?.net ?? 0} short colored />}
          icon={Scale}
          tone="info"
          loading={daybookQuery.isLoading}
        />
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <div className="flex items-center gap-1.5">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-36" aria-label="From date" />
            <span className="text-muted-foreground">–</span>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-36" aria-label="To date" />
          </div>

          <Select value={mode || "__all__"} onValueChange={(v) => setMode(v === "__all__" ? "" : (v as PaymentMode))}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Mode" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All modes</SelectItem>
              {PAYMENT_MODES.map((m) => <SelectItem key={m} value={m}>{humanize(m)}</SelectItem>)}
            </SelectContent>
          </Select>

          {(from !== monthStart || to !== today || mode !== "") && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => { setFrom(monthStart); setTo(today); setMode(""); }}
            >
              Reset
            </Button>
          )}

          {byMode.length > 0 && (
            <div className="flex flex-1 flex-wrap items-center justify-end gap-1.5">
              {byMode.map((row) => (
                <span
                  key={row.mode}
                  className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs"
                >
                  <span className="font-medium">{humanize(row.mode)}</span>
                  <MoneyText value={row.in} short className="text-status-paid" />
                  <span className="text-muted-foreground">/</span>
                  <MoneyText value={row.out} short className="text-status-overdue" />
                </span>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <DataTable
        columns={columns}
        rows={daybookQuery.data?.entries ?? []}
        rowKey={(row) => row.id}
        loading={daybookQuery.isLoading}
        empty={<EmptyState title="Nothing settled" description="No payments were received or paid out in this period." />}
        ariaLabel="Payments daybook"
      />
    </div>
  );
}
