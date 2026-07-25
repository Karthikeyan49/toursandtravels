import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Briefcase, Megaphone, Target, TrendingUp } from "lucide-react";
import { qk } from "@/lib/api/queries";
import { getLeadSourceRoiReport, type LeadSourceRoiRow, type ReportPeriodParams } from "@/lib/api/reports";
import { formatMoneyShort, formatNumber } from "@/lib/format";
import { StatCard } from "@/components/StatCard";
import { DataTable, type Column } from "@/components/DataTable";
import { MoneyText } from "@/components/MoneyText";
import { Badge } from "@/components/ui/badge";
import { ExportButton, FilterBar, PercentText, TotalCell, type ExportParams } from "@/pages/reports/shared";

/**
 * Which lead sources actually pay for themselves. ROI and cost-per-acquisition
 * are `null` whenever no marketing spend has been attributed to a source — that
 * is "we do not know", not "zero", so those cells read as an em dash.
 */

export function LeadSourceRoiTab({ active, from, to }: { active: boolean; from: string; to: string }) {
  const filters: ReportPeriodParams = useMemo(
    () => ({ from: from || undefined, to: to || undefined }),
    [from, to],
  );

  const exportParams: ExportParams = useMemo(() => ({ ...filters }), [filters]);

  const reportQuery = useQuery({
    queryKey: qk.reports.leadSourceRoi(filters),
    queryFn: () => getLeadSourceRoiReport(filters),
    enabled: active,
  });

  const report = reportQuery.data;
  const totals = report?.totals;

  const columns: Column<LeadSourceRoiRow>[] = [
    {
      key: "source_name",
      header: "Source",
      render: (row) => (
        <div className="flex items-center gap-2">
          <span className="font-medium">{row.source_name}</span>
          {row.is_paid === 1 && <Badge variant="secondary">Paid</Badge>}
        </div>
      ),
    },
    { key: "lead_count", header: "Leads", align: "right", render: (row) => formatNumber(row.lead_count) },
    {
      key: "quote_rate_pct",
      header: "Quoted",
      align: "right",
      render: (row) => (
        <div>
          <PercentText value={row.quote_rate_pct} />
          <p className="text-xs text-muted-foreground">{formatNumber(row.quoted_lead_count)} lead(s)</p>
        </div>
      ),
      hideOnMobile: true,
    },
    {
      key: "win_rate_pct",
      header: "Won",
      align: "right",
      render: (row) => (
        <div>
          <PercentText value={row.win_rate_pct} />
          <p className="text-xs text-muted-foreground">
            {formatNumber(row.won_count)} of {formatNumber(row.lead_count)}
          </p>
        </div>
      ),
    },
    {
      key: "booking_count",
      header: "Bookings",
      align: "right",
      render: (row) => formatNumber(row.booking_count),
      hideOnMobile: true,
    },
    {
      key: "revenue",
      header: "Revenue",
      align: "right",
      render: (row) => (
        <div>
          <MoneyText value={row.revenue} />
          <p className="text-xs text-muted-foreground">{formatMoneyShort(row.revenue_per_lead)} / lead</p>
        </div>
      ),
    },
    {
      key: "estimated_margin",
      header: "Est. margin",
      align: "right",
      render: (row) => <MoneyText value={row.estimated_margin} colored />,
      hideOnMobile: true,
    },
    {
      key: "allocated_spend",
      header: "Spend",
      align: "right",
      render: (row) => <MoneyText value={row.allocated_spend} muted />,
      hideOnMobile: true,
    },
    {
      key: "cost_per_acquisition",
      header: "Cost / booking",
      align: "right",
      render: (row) =>
        row.cost_per_acquisition === null ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <MoneyText value={row.cost_per_acquisition} />
        ),
      hideOnMobile: true,
    },
    {
      key: "roi_pct",
      header: "ROI",
      align: "right",
      render: (row) => (
        <span
          className={
            row.roi_pct === null
              ? "text-muted-foreground"
              : row.roi_pct >= 0
                ? "font-medium text-status-paid"
                : "font-medium text-status-overdue"
          }
        >
          <PercentText value={row.roi_pct} decimals={0} />
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Leads"
          value={totals ? formatNumber(totals.lead_count) : "—"}
          icon={Target}
          hint={totals ? `${formatNumber(totals.won_count)} won` : undefined}
          loading={reportQuery.isLoading}
        />
        <StatCard
          label="Bookings"
          value={totals ? formatNumber(totals.booking_count) : "—"}
          icon={Briefcase}
          tone="info"
          loading={reportQuery.isLoading}
        />
        <StatCard
          label="Revenue"
          value={totals ? <MoneyText value={totals.revenue} short /> : "—"}
          icon={TrendingUp}
          tone="positive"
          loading={reportQuery.isLoading}
        />
        <StatCard
          label="Marketing spend"
          value={report ? <MoneyText value={report.marketing_spend} short /> : "—"}
          icon={Megaphone}
          tone="warning"
          hint={report?.spend_note}
          loading={reportQuery.isLoading}
        />
      </div>

      <FilterBar>
        <p className="text-sm text-muted-foreground">
          {report?.spend_note ?? "Attributed marketing spend drives ROI and cost per acquisition."}
        </p>
        <div className="ml-auto">
          <ExportButton slug="lead-source-roi" params={exportParams} />
        </div>
      </FilterBar>

      <DataTable
        columns={columns}
        rows={report?.rows ?? []}
        rowKey={(row) => row.source_id}
        loading={reportQuery.isLoading}
        ariaLabel="Lead source ROI"
        footer={
          totals && (
            <>
              <TotalCell align="left">Total</TotalCell>
              <TotalCell>{formatNumber(totals.lead_count)}</TotalCell>
              <TotalCell hideOnMobile />
              <TotalCell>{formatNumber(totals.won_count)}</TotalCell>
              <TotalCell hideOnMobile>{formatNumber(totals.booking_count)}</TotalCell>
              <TotalCell>
                <MoneyText value={totals.revenue} />
              </TotalCell>
              <TotalCell hideOnMobile />
              <TotalCell hideOnMobile>
                <MoneyText value={report?.marketing_spend} />
              </TotalCell>
              <TotalCell hideOnMobile />
              <TotalCell />
            </>
          )
        }
      />
    </div>
  );
}
