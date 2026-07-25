import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CalendarClock, Clock, Hourglass, Wallet } from "lucide-react";
import { qk } from "@/lib/api/queries";
import { getPayables, type PayableRow } from "@/lib/api/finance";
import { compareValues, humanize, isBlank, toNumber } from "@/lib/utils";
import { PageHeader } from "@/components/PageHeader";
import { StatCard } from "@/components/StatCard";
import { DataTable, type Column, type SortState } from "@/components/DataTable";
import { MoneyText } from "@/components/MoneyText";
import { EmptyState } from "@/components/EmptyState";
import { Badge } from "@/components/ui/badge";
import { TableCell } from "@/components/ui/table";

/**
 * Supplier ageing. `GET /finance/payables` already buckets every open bill by
 * how overdue it is, so this screen renders those buckets as columns rather
 * than recomputing them. Like receivables it is a full roll-up — no filters,
 * no pagination — so sorting happens client-side over the whole set.
 */

const DEFAULT_SORT: SortState = { key: "outstanding", direction: "desc" };

function sortValue(row: PayableRow, key: string): unknown {
  switch (key) {
    case "supplier_name":
      return row.supplier_name;
    case "supplier_type":
      return row.supplier_type;
    case "bill_count":
      return row.bill_count;
    case "outstanding":
      return toNumber(row.outstanding);
    case "not_due":
      return toNumber(row.not_due);
    case "days_1_30":
      return toNumber(row.days_1_30);
    case "days_31_60":
      return toNumber(row.days_31_60);
    case "days_60_plus":
      return toNumber(row.days_60_plus);
    default:
      return null;
  }
}

/** Ageing cells read as noise when they are zero — dim those, flag the bad ones. */
function BucketAmount({ value, tone }: { value: PayableRow["outstanding"]; tone?: string }) {
  const amount = toNumber(value);
  if (amount === 0) return <MoneyText value={0} muted compactZeros />;
  return <MoneyText value={value} className={tone} />;
}

export default function Payables() {
  const navigate = useNavigate();
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT);

  const payablesQuery = useQuery({ queryKey: qk.finance.payables, queryFn: getPayables });

  const suppliers = payablesQuery.data?.suppliers;
  const totals = payablesQuery.data?.totals;

  const rows = useMemo(() => {
    const items = suppliers ?? [];
    return [...items].sort((a, b) => {
      const left = sortValue(a, sort.key);
      const right = sortValue(b, sort.key);
      // Blanks sink in both directions, so only real values get flipped.
      if (isBlank(left) || isBlank(right)) return compareValues(left, right);
      const result = compareValues(left, right);
      return sort.direction === "asc" ? result : -result;
    });
  }, [suppliers, sort]);

  const billTotal = useMemo(
    () => (suppliers ?? []).reduce((sum, row) => sum + toNumber(row.bill_count), 0),
    [suppliers],
  );

  const columns: Column<PayableRow>[] = [
    {
      key: "supplier_name",
      header: "Supplier",
      sortable: true,
      render: (row) => <p className="font-medium">{row.supplier_name}</p>,
    },
    {
      key: "supplier_type",
      header: "Type",
      sortable: true,
      render: (row) => <Badge variant="secondary">{humanize(row.supplier_type)}</Badge>,
      hideOnMobile: true,
    },
    {
      key: "bill_count",
      header: "Bills",
      align: "right",
      sortable: true,
      render: (row) => <span className="tabular">{row.bill_count}</span>,
      hideOnMobile: true,
    },
    {
      key: "outstanding",
      header: "Outstanding",
      align: "right",
      sortable: true,
      render: (row) => <MoneyText value={row.outstanding} />,
    },
    {
      key: "not_due",
      header: "Not due",
      align: "right",
      sortable: true,
      render: (row) => <BucketAmount value={row.not_due} />,
      hideOnMobile: true,
    },
    {
      key: "days_1_30",
      header: "1–30 days",
      align: "right",
      sortable: true,
      render: (row) => <BucketAmount value={row.days_1_30} tone="text-status-pending" />,
      hideOnMobile: true,
    },
    {
      key: "days_31_60",
      header: "31–60 days",
      align: "right",
      sortable: true,
      render: (row) => <BucketAmount value={row.days_31_60} tone="text-status-pending" />,
      hideOnMobile: true,
    },
    {
      key: "days_60_plus",
      header: "60+ days",
      align: "right",
      sortable: true,
      render: (row) => <BucketAmount value={row.days_60_plus} tone="text-status-overdue" />,
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Payables"
        description="What we owe suppliers, aged by how long the bill has been open."
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard
          label="Total outstanding"
          value={<MoneyText value={totals?.outstanding ?? 0} short />}
          icon={Wallet}
          tone="warning"
          hint={`${rows.length} supplier(s) · ${billTotal} bill(s)`}
          loading={payablesQuery.isLoading}
        />
        <StatCard
          label="Not due"
          value={<MoneyText value={totals?.not_due ?? 0} short />}
          icon={CalendarClock}
          tone="default"
          hint="within credit terms"
          loading={payablesQuery.isLoading}
        />
        <StatCard
          label="1–30 days"
          value={<MoneyText value={totals?.days_1_30 ?? 0} short />}
          icon={Clock}
          tone="info"
          loading={payablesQuery.isLoading}
        />
        <StatCard
          label="31–60 days"
          value={<MoneyText value={totals?.days_31_60 ?? 0} short />}
          icon={Hourglass}
          tone="warning"
          loading={payablesQuery.isLoading}
        />
        <StatCard
          label="60+ days"
          value={<MoneyText value={totals?.days_60_plus ?? 0} short />}
          icon={AlertTriangle}
          tone="negative"
          hint="chase these first"
          loading={payablesQuery.isLoading}
        />
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.supplier_id}
        loading={payablesQuery.isLoading}
        onRowClick={(row) => navigate(`/suppliers/${row.supplier_id}`)}
        sort={sort}
        onSortChange={setSort}
        ariaLabel="Supplier payables ageing"
        rowClassName={(row) => (toNumber(row.days_60_plus) > 0 ? "bg-status-overdue-bg/40" : undefined)}
        empty={
          <EmptyState
            title="Nothing payable"
            description="Every approved supplier bill has been settled."
          />
        }
        footer={
          totals && (
            <>
              <TableCell className="font-medium">Total</TableCell>
              <TableCell className="hidden md:table-cell" />
              <TableCell className="hidden text-right tabular md:table-cell">{billTotal}</TableCell>
              <TableCell className="text-right">
                <MoneyText value={totals.outstanding} />
              </TableCell>
              <TableCell className="hidden text-right md:table-cell">
                <MoneyText value={totals.not_due} />
              </TableCell>
              <TableCell className="hidden text-right md:table-cell">
                <MoneyText value={totals.days_1_30} />
              </TableCell>
              <TableCell className="hidden text-right md:table-cell">
                <MoneyText value={totals.days_31_60} />
              </TableCell>
              <TableCell className="text-right">
                <MoneyText value={totals.days_60_plus} />
              </TableCell>
            </>
          )
        }
      />
    </div>
  );
}
