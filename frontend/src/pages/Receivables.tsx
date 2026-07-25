import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CalendarClock, Users, Wallet } from "lucide-react";
import { qk } from "@/lib/api/queries";
import { getReceivables, type ReceivableRow } from "@/lib/api/finance";
import { daysUntil, formatDate, formatPhone } from "@/lib/format";
import { compareValues, isBlank, toNumber } from "@/lib/utils";
import { PageHeader } from "@/components/PageHeader";
import { StatCard } from "@/components/StatCard";
import { DataTable, type Column, type SortState } from "@/components/DataTable";
import { MoneyText } from "@/components/MoneyText";
import { EmptyState } from "@/components/EmptyState";
import { TableCell } from "@/components/ui/table";

/**
 * Customer ageing. `GET /finance/receivables` answers with the complete
 * roll-up — no filters, no pagination, no sort parameter — so sorting is done
 * here over the full set rather than round-tripping to the API.
 */

const DEFAULT_SORT: SortState = { key: "outstanding", direction: "desc" };

function sortValue(row: ReceivableRow, key: string): unknown {
  switch (key) {
    case "customer_name":
      return row.customer_name;
    case "phone":
      return row.phone;
    case "booking_count":
      return row.booking_count;
    case "outstanding":
      return toNumber(row.outstanding);
    case "next_departure":
      return row.next_departure;
    case "due_within_7_days":
      return toNumber(row.due_within_7_days);
    default:
      return null;
  }
}

export default function Receivables() {
  const navigate = useNavigate();
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT);

  const receivablesQuery = useQuery({ queryKey: qk.finance.receivables, queryFn: getReceivables });

  const customers = receivablesQuery.data?.customers;
  const totals = receivablesQuery.data?.totals;

  const rows = useMemo(() => {
    const items = customers ?? [];
    return [...items].sort((a, b) => {
      const left = sortValue(a, sort.key);
      const right = sortValue(b, sort.key);
      // Blanks sink in both directions, so only real values get flipped.
      if (isBlank(left) || isBlank(right)) return compareValues(left, right);
      const result = compareValues(left, right);
      return sort.direction === "asc" ? result : -result;
    });
  }, [customers, sort]);

  const bookingTotal = useMemo(
    () => (customers ?? []).reduce((sum, row) => sum + toNumber(row.booking_count), 0),
    [customers],
  );

  const columns: Column<ReceivableRow>[] = [
    {
      key: "customer_name",
      header: "Customer",
      sortable: true,
      render: (row) => <p className="font-medium">{row.customer_name}</p>,
    },
    {
      key: "phone",
      header: "Phone",
      sortable: true,
      render: (row) => <span className="tabular">{formatPhone(row.phone)}</span>,
      hideOnMobile: true,
    },
    {
      key: "booking_count",
      header: "Bookings",
      align: "right",
      sortable: true,
      render: (row) => <span className="tabular">{row.booking_count}</span>,
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
      key: "next_departure",
      header: "Next departure",
      sortable: true,
      render: (row) => {
        const days = daysUntil(row.next_departure);
        return (
          <div>
            <p>{formatDate(row.next_departure)}</p>
            {days !== null && (
              <p className="text-xs text-muted-foreground">{days < 0 ? "departed" : `${days}d away`}</p>
            )}
          </div>
        );
      },
      hideOnMobile: true,
    },
    {
      key: "due_within_7_days",
      header: "Due in 7 days",
      align: "right",
      sortable: true,
      render: (row) =>
        toNumber(row.due_within_7_days) > 0 ? (
          <MoneyText value={row.due_within_7_days} className="text-status-pending" />
        ) : (
          <MoneyText value={row.due_within_7_days} muted />
        ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Receivables"
        description="Money still to collect, by customer. Payments recorded against a booking clear here immediately."
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          label="Total outstanding"
          value={<MoneyText value={totals?.outstanding ?? 0} short />}
          icon={Wallet}
          tone="warning"
          loading={receivablesQuery.isLoading}
        />
        <StatCard
          label="Due within 7 days"
          value={<MoneyText value={totals?.due_within_7_days ?? 0} short />}
          icon={CalendarClock}
          tone="negative"
          hint="departing customers with a balance"
          loading={receivablesQuery.isLoading}
        />
        <StatCard
          label="Customers with a balance"
          value={rows.length}
          icon={Users}
          tone="info"
          hint={`${bookingTotal} booking(s)`}
          loading={receivablesQuery.isLoading}
        />
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.customer_id}
        loading={receivablesQuery.isLoading}
        onRowClick={(row) => navigate(`/customers/${row.customer_id}`)}
        sort={sort}
        onSortChange={setSort}
        ariaLabel="Customer receivables"
        empty={
          <EmptyState
            title="Nothing outstanding"
            description="Every customer is paid up — no balances to chase right now."
          />
        }
        footer={
          totals && (
            <>
              <TableCell className="font-medium">Total</TableCell>
              <TableCell className="hidden md:table-cell" />
              <TableCell className="hidden text-right tabular md:table-cell">{bookingTotal}</TableCell>
              <TableCell className="text-right">
                <MoneyText value={totals.outstanding} />
              </TableCell>
              <TableCell className="hidden md:table-cell" />
              <TableCell className="text-right">
                <MoneyText value={totals.due_within_7_days} />
              </TableCell>
            </>
          )
        }
      />
    </div>
  );
}
