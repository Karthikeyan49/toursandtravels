import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { startOfMonth } from "date-fns";
import { Receipt, TrendingDown, TrendingUp, Users } from "lucide-react";
import { qk } from "@/lib/api/queries";
import { getProfitAndLoss, type ProfitAndLoss } from "@/lib/api/finance";
import { formatDateRange, formatNumber, formatPercent, toISODate } from "@/lib/format";
import { cn, humanize, toNumber } from "@/lib/utils";
import { PageHeader } from "@/components/PageHeader";
import { StatCard } from "@/components/StatCard";
import { MoneyText } from "@/components/MoneyText";
import { EmptyState } from "@/components/EmptyState";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * The period P&L, rendered as a statement rather than a table: revenue, the
 * cost-of-sale breakdown, gross profit, overheads, net profit. Every figure
 * comes straight off `GET /finance/pl` — nothing is recomputed here, so the
 * screen can never disagree with the accounts.
 */

const TODAY = new Date();
const DEFAULT_FROM = toISODate(startOfMonth(TODAY)) ?? "";
const DEFAULT_TO = toISODate(TODAY) ?? "";

function SectionHeading({ children }: { children: ReactNode }) {
  return (
    <p className="pt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground first:pt-0">
      {children}
    </p>
  );
}

/** An indented cost/revenue component line. */
function StatementLine({ label, value, muted = false }: { label: string; value: ReactNode; muted?: boolean }) {
  return (
    <div
      className={cn(
        "flex items-baseline justify-between gap-4 py-1.5 pl-4 text-sm",
        muted && "text-muted-foreground",
      )}
    >
      <span className="min-w-0 truncate">{label}</span>
      <span className="shrink-0">{value}</span>
    </div>
  );
}

/** A ruled subtotal — the line the indented components above add up to. */
function StatementSubtotal({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="mt-1 flex items-baseline justify-between gap-4 border-t pt-2 text-sm font-medium">
      <span className="flex flex-wrap items-baseline gap-2">
        {label}
        {hint && <span className="text-xs font-normal text-muted-foreground">{hint}</span>}
      </span>
      <span className="shrink-0">{value}</span>
    </div>
  );
}

function Statement({ pl }: { pl: ProfitAndLoss }) {
  const netNegative = toNumber(pl.net_profit) < 0;
  const NetIcon = netNegative ? TrendingDown : TrendingUp;

  return (
    <div className="space-y-1">
      <SectionHeading>Revenue</SectionHeading>
      <StatementLine label="Confirmed booking revenue" value={<MoneyText value={pl.revenue} />} />

      <SectionHeading>Cost of sales</SectionHeading>
      <StatementLine label="Supplier bills" value={<MoneyText value={pl.cogs.supplier_bills} />} />
      <StatementLine label="Direct expenses" value={<MoneyText value={pl.cogs.direct_expenses} />} />
      <StatementLine label="Agent commission" value={<MoneyText value={pl.cogs.agent_commission} />} />
      <StatementSubtotal label="Total cost of sales" value={<MoneyText value={pl.cogs.total} />} />

      <div className="mt-3 flex items-baseline justify-between gap-4 rounded-md bg-muted/60 px-3 py-2.5">
        <span className="flex flex-wrap items-baseline gap-2 text-sm font-semibold">
          Gross profit
          <span className="text-xs font-normal text-muted-foreground">
            {formatPercent(pl.gross_margin_pct)} margin
          </span>
        </span>
        <MoneyText value={pl.gross_profit} colored className="shrink-0 text-base font-semibold" />
      </div>

      <SectionHeading>Overheads</SectionHeading>
      {pl.overheads.length === 0 ? (
        <StatementLine label="No overheads booked in this period" value="—" muted />
      ) : (
        pl.overheads.map((line) => (
          <StatementLine
            key={line.category}
            label={humanize(line.category) || line.category}
            value={<MoneyText value={line.amount} />}
          />
        ))
      )}
      <StatementSubtotal label="Total overheads" value={<MoneyText value={pl.overhead_total} />} />

      <div
        className={cn(
          "mt-3 flex items-center justify-between gap-4 rounded-lg border px-3 py-3",
          netNegative ? "border-status-overdue bg-status-overdue-bg" : "border-status-paid bg-status-paid-bg",
        )}
      >
        <div className="flex items-center gap-2.5">
          <span
            className={cn(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
              netNegative ? "text-status-overdue" : "text-status-paid",
            )}
          >
            <NetIcon className="h-4 w-4" aria-hidden />
          </span>
          <div>
            <p className="text-sm font-semibold">{netNegative ? "Net loss" : "Net profit"}</p>
            <p className="text-xs text-muted-foreground">{formatPercent(pl.net_margin_pct)} net margin</p>
          </div>
        </div>
        <MoneyText value={pl.net_profit} colored className="shrink-0 text-lg font-semibold" />
      </div>
    </div>
  );
}

export default function ProfitLoss() {
  const [from, setFrom] = useState(DEFAULT_FROM);
  const [to, setTo] = useState(DEFAULT_TO);

  const periodReady = from !== "" && to !== "";

  const plQuery = useQuery({
    queryKey: qk.finance.profitAndLoss(from, to),
    queryFn: () => getProfitAndLoss({ from, to }),
    enabled: periodReady,
  });

  const pl = plQuery.data;

  const description = useMemo(
    () => (periodReady ? `Period ${formatDateRange(from, to)}` : "Choose a period to run the statement."),
    [periodReady, from, to],
  );

  return (
    <div className="space-y-5">
      <PageHeader title="Profit & loss" description={description} />

      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <div className="flex items-center gap-1.5">
            <Input
              type="date"
              value={from}
              max={to || undefined}
              onChange={(e) => setFrom(e.target.value)}
              className="w-40"
              aria-label="Period from"
            />
            <span className="text-muted-foreground">–</span>
            <Input
              type="date"
              value={to}
              min={from || undefined}
              onChange={(e) => setTo(e.target.value)}
              className="w-40"
              aria-label="Period to"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Revenue is recognised on confirmed bookings travelling in the period.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Statement</CardTitle>
        </CardHeader>
        <CardContent>
          {!periodReady ? (
            <EmptyState
              compact
              title="Pick a period"
              description="Set both a from and a to date to run the profit & loss."
            />
          ) : plQuery.isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 10 }, (_, i) => (
                <Skeleton key={i} className="h-6 w-full" />
              ))}
            </div>
          ) : !pl ? (
            <EmptyState
              compact
              title="No statement for this period"
              description="Nothing was booked or spent between these dates."
            />
          ) : (
            <Statement pl={pl} />
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          label="Revenue per pax"
          value={<MoneyText value={pl?.revenue_per_pax ?? 0} />}
          icon={Receipt}
          tone="info"
          loading={plQuery.isLoading}
        />
        <StatCard
          label="Bookings"
          value={pl ? formatNumber(pl.booking_count) : "—"}
          icon={TrendingUp}
          hint="confirmed in this period"
          loading={plQuery.isLoading}
        />
        <StatCard
          label="Passengers"
          value={pl ? formatNumber(pl.pax) : "—"}
          icon={Users}
          tone="default"
          loading={plQuery.isLoading}
        />
      </div>
    </div>
  );
}
