import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Briefcase, TrendingUp, Users, Wallet } from "lucide-react";
import { qk } from "@/lib/api/queries";
import {
  getSalesReport,
  SALES_GROUP_BY,
  type SalesGroupBy,
  type SalesReportFilters,
  type SalesReportRow,
} from "@/lib/api/reports";
import { formatNumber, formatPercent } from "@/lib/format";
import { humanize } from "@/lib/utils";
import { StatCard } from "@/components/StatCard";
import { DataTable, type Column } from "@/components/DataTable";
import { MoneyText } from "@/components/MoneyText";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DestinationSelect,
  ExportButton,
  FilterBar,
  OwnerSelect,
  PackageSelect,
  TotalCell,
  type ExportParams,
} from "@/pages/reports/shared";

/**
 * Revenue rolled up along whichever dimension the user picks. `date_basis`
 * decides whether a booking lands in the period it was sold in or the period it
 * travels in — the two give very different monthly numbers, so it is explicit.
 */

const GROUP_BY_LABELS: Record<SalesGroupBy, string> = {
  period: "Month sold",
  travel_month: "Travel month",
  destination: "Destination",
  package: "Package",
  staff: "Staff",
  source: "Lead source",
  agency: "Agency",
  booking_type: "Booking type",
};

export function SalesReportTab({ active, from, to }: { active: boolean; from: string; to: string }) {
  const [groupBy, setGroupBy] = useState<SalesGroupBy>("period");
  const [dateBasis, setDateBasis] = useState<"travel" | "booking">("booking");
  const [destinationId, setDestinationId] = useState("");
  const [packageId, setPackageId] = useState("");
  const [ownerId, setOwnerId] = useState("");

  const filters: SalesReportFilters = useMemo(
    () => ({
      from: from || undefined,
      to: to || undefined,
      group_by: groupBy,
      date_basis: dateBasis,
      destination_id: destinationId ? Number(destinationId) : undefined,
      package_id: packageId ? Number(packageId) : undefined,
      owner_id: ownerId ? Number(ownerId) : undefined,
    }),
    [from, to, groupBy, dateBasis, destinationId, packageId, ownerId],
  );

  const exportParams: ExportParams = useMemo(() => ({ ...filters }), [filters]);

  const reportQuery = useQuery({
    queryKey: qk.reports.sales(filters),
    queryFn: () => getSalesReport(filters),
    enabled: active,
  });

  const report = reportQuery.data;
  const totals = report?.totals;

  const columns: Column<SalesReportRow>[] = [
    {
      key: "dimension",
      header: report?.dimension_label ?? GROUP_BY_LABELS[groupBy],
      render: (row) => <span className="font-medium">{row.dimension}</span>,
    },
    { key: "booking_count", header: "Bookings", align: "right", render: (row) => formatNumber(row.booking_count) },
    { key: "pax", header: "Pax", align: "right", render: (row) => formatNumber(row.pax), hideOnMobile: true },
    {
      key: "net_revenue",
      header: "Net revenue",
      align: "right",
      render: (row) => <MoneyText value={row.net_revenue} />,
      hideOnMobile: true,
    },
    {
      key: "gst",
      header: "GST",
      align: "right",
      render: (row) => <MoneyText value={row.gst} muted />,
      hideOnMobile: true,
    },
    {
      key: "gross_revenue",
      header: "Gross revenue",
      align: "right",
      render: (row) => <MoneyText value={row.gross_revenue} />,
    },
    {
      key: "estimated_cost",
      header: "Est. cost",
      align: "right",
      render: (row) => <MoneyText value={row.estimated_cost} muted />,
      hideOnMobile: true,
    },
    {
      key: "margin",
      header: "Margin",
      align: "right",
      render: (row) => (
        <div>
          <MoneyText value={row.margin} colored />
          <p className="tabular text-xs text-muted-foreground">{formatPercent(row.margin_pct)}</p>
        </div>
      ),
    },
    {
      key: "collected",
      header: "Collected",
      align: "right",
      render: (row) => <MoneyText value={row.collected} />,
      hideOnMobile: true,
    },
    {
      key: "outstanding",
      header: "Outstanding",
      align: "right",
      render: (row) =>
        Number(row.outstanding) > 0 ? (
          <MoneyText value={row.outstanding} className="text-status-overdue" />
        ) : (
          <MoneyText value={row.outstanding} muted />
        ),
    },
    {
      key: "avg_booking",
      header: "Avg booking",
      align: "right",
      render: (row) => <MoneyText value={row.avg_booking} short />,
      hideOnMobile: true,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Bookings"
          value={totals ? formatNumber(totals.booking_count) : "—"}
          icon={Briefcase}
          hint={totals ? `${formatNumber(totals.pax)} pax` : undefined}
          loading={reportQuery.isLoading}
        />
        <StatCard
          label="Gross revenue"
          value={totals ? <MoneyText value={totals.gross_revenue} short /> : "—"}
          icon={Wallet}
          tone="info"
          hint={totals ? `Net ${formatNumber(totals.net_revenue)}` : undefined}
          loading={reportQuery.isLoading}
        />
        <StatCard
          label="Estimated margin"
          value={totals ? <MoneyText value={totals.margin} short colored /> : "—"}
          icon={TrendingUp}
          tone="positive"
          hint={totals ? `Cost ${formatNumber(totals.estimated_cost)}` : undefined}
          loading={reportQuery.isLoading}
        />
        <StatCard
          label="Collected"
          value={totals ? <MoneyText value={totals.collected} short /> : "—"}
          icon={Users}
          tone="warning"
          hint={totals ? `Outstanding ${formatNumber(totals.outstanding)}` : undefined}
          loading={reportQuery.isLoading}
        />
      </div>

      <FilterBar>
        <Select value={groupBy} onValueChange={(v) => setGroupBy(v as SalesGroupBy)}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Group by" />
          </SelectTrigger>
          <SelectContent>
            {SALES_GROUP_BY.map((g) => (
              <SelectItem key={g} value={g}>
                {GROUP_BY_LABELS[g]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={dateBasis} onValueChange={(v) => setDateBasis(v === "travel" ? "travel" : "booking")}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Date basis" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="booking">By booking date</SelectItem>
            <SelectItem value="travel">By travel date</SelectItem>
          </SelectContent>
        </Select>

        <DestinationSelect
          value={destinationId}
          onChange={(v) => {
            setDestinationId(v);
            setPackageId("");
          }}
        />
        <PackageSelect
          value={packageId}
          onChange={setPackageId}
          destinationId={destinationId ? Number(destinationId) : undefined}
        />
        <OwnerSelect value={ownerId} onChange={setOwnerId} />

        <div className="ml-auto">
          <ExportButton slug="sales" params={exportParams} />
        </div>
      </FilterBar>

      <DataTable
        columns={columns}
        rows={report?.rows ?? []}
        rowKey={(row) => row.dimension}
        loading={reportQuery.isLoading}
        ariaLabel={`Sales by ${humanize(groupBy)}`}
        footer={
          totals && (
            <>
              <TotalCell align="left">Total</TotalCell>
              <TotalCell>{formatNumber(totals.booking_count)}</TotalCell>
              <TotalCell hideOnMobile>{formatNumber(totals.pax)}</TotalCell>
              <TotalCell hideOnMobile>
                <MoneyText value={totals.net_revenue} />
              </TotalCell>
              <TotalCell hideOnMobile />
              <TotalCell>
                <MoneyText value={totals.gross_revenue} />
              </TotalCell>
              <TotalCell hideOnMobile>
                <MoneyText value={totals.estimated_cost} />
              </TotalCell>
              <TotalCell>
                <MoneyText value={totals.margin} colored />
              </TotalCell>
              <TotalCell hideOnMobile>
                <MoneyText value={totals.collected} />
              </TotalCell>
              <TotalCell>
                <MoneyText value={totals.outstanding} />
              </TotalCell>
              <TotalCell hideOnMobile />
            </>
          )
        }
      />
    </div>
  );
}
