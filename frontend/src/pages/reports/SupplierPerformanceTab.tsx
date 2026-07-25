import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Clock, Truck, Wallet } from "lucide-react";
import { qk } from "@/lib/api/queries";
import {
  getSupplierPerformanceReport,
  type SupplierPerformanceFilters,
  type SupplierPerformanceRow,
} from "@/lib/api/reports";
import { SUPPLIER_TYPES, type SupplierType } from "@/lib/api/suppliers";
import { formatMoneyShort, formatNumber } from "@/lib/format";
import { humanize } from "@/lib/utils";
import { StatCard } from "@/components/StatCard";
import { DataTable, type Column } from "@/components/DataTable";
import { MoneyText } from "@/components/MoneyText";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ALL_OPTION,
  DestinationSelect,
  ExportButton,
  FilterBar,
  PercentText,
  TotalCell,
  type ExportParams,
} from "@/pages/reports/shared";

/**
 * Supplier scorecard. On-time confirmation rate and incident rate are the two
 * KPIs the client asked to see first, so they lead the table and get their own
 * column emphasis; billing sits behind them as context.
 */

export function SupplierPerformanceTab({ active, from, to }: { active: boolean; from: string; to: string }) {
  const navigate = useNavigate();

  const [supplierType, setSupplierType] = useState<SupplierType | "">("");
  const [destinationId, setDestinationId] = useState("");

  const filters: SupplierPerformanceFilters = useMemo(
    () => ({
      from: from || undefined,
      to: to || undefined,
      supplier_type: supplierType || undefined,
      destination_id: destinationId ? Number(destinationId) : undefined,
    }),
    [from, to, supplierType, destinationId],
  );

  const exportParams: ExportParams = useMemo(() => ({ ...filters }), [filters]);

  const reportQuery = useQuery({
    queryKey: qk.reports.supplierPerformance(filters),
    queryFn: () => getSupplierPerformanceReport(filters),
    enabled: active,
  });

  const report = reportQuery.data;
  const totals = report?.totals;

  const columns: Column<SupplierPerformanceRow>[] = [
    {
      key: "supplier_name",
      header: "Supplier",
      render: (row) => (
        <div>
          <p className="font-medium">{row.supplier_name}</p>
          <p className="text-xs text-muted-foreground">
            {row.code} · {humanize(row.supplier_type)}
            {row.destination_name ? ` · ${row.destination_name}` : ""}
          </p>
        </div>
      ),
    },
    {
      key: "on_time_pct",
      header: "On time",
      align: "right",
      render: (row) => (
        <div>
          <PercentText value={row.on_time_pct} tone="good-high" className="text-sm font-semibold" />
          <p className="text-xs text-muted-foreground">
            {formatNumber(row.on_time_confirmations)}/{formatNumber(row.service_count)}
          </p>
        </div>
      ),
    },
    {
      key: "incident_rate_pct",
      header: "Incident rate",
      align: "right",
      render: (row) => (
        <div>
          <PercentText value={row.incident_rate_pct} tone="good-low" className="text-sm font-semibold" />
          <p className="text-xs text-muted-foreground">
            {formatNumber(row.incident_count)} incident(s)
            {row.serious_incident_count > 0 ? ` · ${formatNumber(row.serious_incident_count)} serious` : ""}
          </p>
        </div>
      ),
    },
    {
      key: "incident_cost_impact",
      header: "Incident cost",
      align: "right",
      render: (row) =>
        Number(row.incident_cost_impact) > 0 ? (
          <MoneyText value={row.incident_cost_impact} className="text-status-overdue" />
        ) : (
          <MoneyText value={row.incident_cost_impact} muted />
        ),
      hideOnMobile: true,
    },
    {
      key: "billed_amount",
      header: "Billed",
      align: "right",
      render: (row) => (
        <div>
          <MoneyText value={row.billed_amount} />
          <p className="text-xs text-muted-foreground">{formatNumber(row.bill_count)} bill(s)</p>
        </div>
      ),
      hideOnMobile: true,
    },
    {
      key: "outstanding",
      header: "Payable",
      align: "right",
      render: (row) =>
        Number(row.outstanding) > 0 ? (
          <MoneyText value={row.outstanding} className="text-status-pending" />
        ) : (
          <MoneyText value={row.outstanding} muted />
        ),
    },
    {
      key: "rating",
      header: "Rating",
      align: "right",
      render: (row) => (
        <span className="tabular">{row.rating === null ? "—" : Number(row.rating).toFixed(1)}</span>
      ),
      hideOnMobile: true,
    },
    {
      key: "credit_days",
      header: "Credit",
      align: "right",
      render: (row) => <span className="tabular">{row.credit_days}d</span>,
      hideOnMobile: true,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Suppliers"
          value={totals ? formatNumber(totals.supplier_count) : "—"}
          icon={Truck}
          hint="with activity in this period"
          loading={reportQuery.isLoading}
        />
        <StatCard
          label="Incidents"
          value={totals ? formatNumber(totals.incidents) : "—"}
          icon={AlertTriangle}
          tone="negative"
          hint="logged against these suppliers"
          loading={reportQuery.isLoading}
        />
        <StatCard
          label="Billed"
          value={totals ? <MoneyText value={totals.billed_amount} short /> : "—"}
          icon={Wallet}
          tone="info"
          loading={reportQuery.isLoading}
        />
        <StatCard
          label="Payable outstanding"
          value={totals ? <MoneyText value={totals.outstanding} short /> : "—"}
          icon={Clock}
          tone="warning"
          hint={totals ? `of ${formatMoneyShort(totals.billed_amount)} billed` : undefined}
          loading={reportQuery.isLoading}
        />
      </div>

      <FilterBar>
        <Select
          value={supplierType || ALL_OPTION}
          onValueChange={(v) => setSupplierType(v === ALL_OPTION ? "" : (v as SupplierType))}
        >
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Supplier type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_OPTION}>All supplier types</SelectItem>
            {SUPPLIER_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {humanize(t)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <DestinationSelect value={destinationId} onChange={setDestinationId} />

        <div className="ml-auto">
          <ExportButton slug="supplier-performance" params={exportParams} />
        </div>
      </FilterBar>

      <DataTable
        columns={columns}
        rows={report?.suppliers ?? []}
        rowKey={(row) => row.id}
        loading={reportQuery.isLoading}
        onRowClick={(row) => navigate(`/suppliers/${row.id}`)}
        ariaLabel="Supplier performance"
        footer={
          totals && (
            <>
              <TotalCell align="left">{formatNumber(totals.supplier_count)} supplier(s)</TotalCell>
              <TotalCell />
              <TotalCell>{formatNumber(totals.incidents)}</TotalCell>
              <TotalCell hideOnMobile />
              <TotalCell hideOnMobile>
                <MoneyText value={totals.billed_amount} />
              </TotalCell>
              <TotalCell>
                <MoneyText value={totals.outstanding} />
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
