import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Briefcase, TrendingUp, Wallet } from "lucide-react";
import { qk } from "@/lib/api/queries";
import { getMarginReport, type MarginReportFilters, type MarginReportRow } from "@/lib/api/reports";
import { formatDate, formatMoneyShort, formatNumber, formatPercent } from "@/lib/format";
import { toNumber } from "@/lib/utils";
import { StatCard } from "@/components/StatCard";
import { DataTable, type Column } from "@/components/DataTable";
import { MoneyText } from "@/components/MoneyText";
import { StatusBadge } from "@/components/StatusBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
 * Booking-level profitability. Two things have to be impossible to miss: a
 * booking that is losing money, and a booking whose cost is still an estimate —
 * the margin on the latter is a guess until the supplier bills land.
 */

export function MarginReportTab({ active, from, to }: { active: boolean; from: string; to: string }) {
  const navigate = useNavigate();

  const [lossMaking, setLossMaking] = useState(false);
  const [destinationId, setDestinationId] = useState("");
  const [packageId, setPackageId] = useState("");
  const [ownerId, setOwnerId] = useState("");

  const filters: MarginReportFilters = useMemo(
    () => ({
      from: from || undefined,
      to: to || undefined,
      loss_making: lossMaking || undefined,
      destination_id: destinationId ? Number(destinationId) : undefined,
      package_id: packageId ? Number(packageId) : undefined,
      owner_id: ownerId ? Number(ownerId) : undefined,
    }),
    [from, to, lossMaking, destinationId, packageId, ownerId],
  );

  const exportParams: ExportParams = useMemo(() => ({ ...filters }), [filters]);

  const reportQuery = useQuery({
    queryKey: qk.reports.margin(filters),
    queryFn: () => getMarginReport(filters),
    enabled: active,
  });

  const report = reportQuery.data;
  const totals = report?.totals;

  const columns: Column<MarginReportRow>[] = [
    {
      key: "booking_no",
      header: "Booking",
      render: (row) => (
        <div>
          <p className="font-medium">{row.booking_no}</p>
          <p className="text-xs text-muted-foreground">{row.customer_name ?? "—"}</p>
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
          <p>{formatDate(row.travel_from)}</p>
          <p className="text-xs text-muted-foreground">{row.pax} pax</p>
        </div>
      ),
      hideOnMobile: true,
    },
    {
      key: "revenue",
      header: "Revenue",
      align: "right",
      render: (row) => <MoneyText value={row.revenue} />,
    },
    {
      key: "actual_cost",
      header: "Cost",
      align: "right",
      render: (row) => (
        <div className="flex items-center justify-end gap-1.5">
          <MoneyText value={row.actual_cost} muted={row.is_estimated} />
          {row.is_estimated && (
            <Badge variant="status" className="bg-status-pending-bg text-status-pending" title="Supplier costs are not finalised yet">
              Est.
            </Badge>
          )}
        </div>
      ),
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
      key: "status",
      header: "Status",
      render: (row) => <StatusBadge status={row.status} size="sm" />,
      hideOnMobile: true,
    },
    {
      key: "owner_name",
      header: "Owner",
      render: (row) => row.owner_name ?? "—",
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
          loading={reportQuery.isLoading}
        />
        <StatCard
          label="Revenue"
          value={totals ? <MoneyText value={totals.revenue} short /> : "—"}
          icon={Wallet}
          tone="info"
          hint={totals ? `Cost ${formatMoneyShort(totals.actual_cost)}` : undefined}
          loading={reportQuery.isLoading}
        />
        <StatCard
          label="Margin"
          value={totals ? <MoneyText value={totals.margin} short colored /> : "—"}
          icon={TrendingUp}
          tone="positive"
          hint={totals ? formatPercent(totals.margin_pct) : undefined}
          loading={reportQuery.isLoading}
        />
        <StatCard
          label="Loss-making"
          value={totals ? formatNumber(totals.loss_making) : "—"}
          icon={AlertTriangle}
          tone="negative"
          hint="bookings below cost"
          loading={reportQuery.isLoading}
        />
      </div>

      <FilterBar>
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

        <Button
          type="button"
          variant={lossMaking ? "default" : "outline"}
          size="sm"
          onClick={() => setLossMaking((v) => !v)}
        >
          Loss-making only
        </Button>

        <div className="ml-auto">
          <ExportButton slug="margin" params={exportParams} />
        </div>
      </FilterBar>

      <DataTable
        columns={columns}
        rows={report?.rows ?? []}
        rowKey={(row) => row.id}
        loading={reportQuery.isLoading}
        onRowClick={(row) => navigate(`/bookings/${row.id}`)}
        ariaLabel="Margin by booking"
        // A loss is flagged in red; an unfinalised cost is tinted amber so the
        // margin beside it reads as provisional rather than settled.
        rowClassName={(row) =>
          toNumber(row.margin) < 0
            ? "bg-status-overdue-bg/40"
            : row.is_estimated
              ? "bg-status-pending-bg/25"
              : undefined
        }
        footer={
          totals && (
            <>
              <TotalCell align="left">Total</TotalCell>
              <TotalCell align="left" hideOnMobile>
                {formatNumber(totals.booking_count)} booking(s)
              </TotalCell>
              <TotalCell hideOnMobile />
              <TotalCell>
                <MoneyText value={totals.revenue} />
              </TotalCell>
              <TotalCell>
                <MoneyText value={totals.actual_cost} />
              </TotalCell>
              <TotalCell>
                <MoneyText value={totals.margin} colored />
                <p className="tabular text-xs font-normal text-muted-foreground">
                  {formatPercent(totals.margin_pct)}
                </p>
              </TotalCell>
              <TotalCell hideOnMobile />
              <TotalCell hideOnMobile />
            </>
          )
        }
      />
    </div>
  );
}
