import { Fragment } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AlertTriangle,
  Briefcase,
  CalendarClock,
  ClipboardList,
  Clock,
  FileText,
  MapPin,
  Plane,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { qk } from "@/lib/api/queries";
import { getDashboardOverview, getMyWork, getSalesFunnel, type DashboardAlert } from "@/lib/api/dashboard";
import { toNumber } from "@/lib/utils";
import { formatDate, formatMoneyShort, relativeTime } from "@/lib/format";
import { CHART_COLORS, DEFAULT_CURRENCY } from "@/lib/constants";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader } from "@/components/PageHeader";
import { StatCard } from "@/components/StatCard";
import { MoneyText } from "@/components/MoneyText";
import { EmptyState } from "@/components/EmptyState";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * The home screen. `DashboardController::overview()` answers almost everything
 * in one request; `sales-funnel` backs the four headline metrics the client
 * named explicitly on the requirements call (total inquiries, quotes
 * dispatched, pending response, conversions); `my-work` is the signed-in
 * user's personal queue.
 *
 * The four headline metrics are not literal fields on either response — they
 * are derived from real ones (see `computeFunnelHeadline` below) rather than
 * invented, since the backend does not name them that way.
 */

function computeFunnelHeadline(
  leads: { total: number; won: number } | undefined,
  quotations: readonly { status: string; quote_count: number | string }[] | undefined,
) {
  const rows = quotations ?? [];
  const countOf = (statuses: readonly string[]) =>
    rows.filter((r) => statuses.includes(r.status)).reduce((sum, r) => sum + toNumber(r.quote_count), 0);

  const totalQuotes = rows.reduce((sum, r) => sum + toNumber(r.quote_count), 0);
  const draftQuotes = countOf(["draft"]);

  return {
    totalInquiries: leads?.total ?? 0,
    totalQuotesDispatched: totalQuotes - draftQuotes,
    pendingResponse: countOf(["sent", "viewed"]),
    conversions: leads?.won ?? 0,
  };
}

const ALERT_META: Record<DashboardAlert["kind"], { label: string; icon: typeof AlertTriangle }> = {
  payment_due: { label: "Payment due", icon: Wallet },
  doc_expiring: { label: "Document expiring", icon: FileText },
  lead_idle: { label: "Lead gone cold", icon: Clock },
  vehicle_doc_expiring: { label: "Vehicle paperwork", icon: AlertTriangle },
};

function alertHref(alert: DashboardAlert): string {
  if (alert.entity_type === "booking") return `/bookings/${alert.entity_id}`;
  if (alert.entity_type === "lead") return `/leads/${alert.entity_id}`;
  return "/fleet";
}

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  label?: string;
  payload?: readonly { name: string; value: number | string; color: string }[];
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-lg border bg-popover p-2.5 text-xs shadow-md">
      <p className="mb-1 font-medium text-foreground">{label}</p>
      <div className="space-y-0.5">
        {payload.map((entry) => (
          <div key={entry.name} className="flex items-center gap-2">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: entry.color }} aria-hidden />
            <span className="text-muted-foreground">{entry.name}:</span>
            <span className="font-medium tabular text-foreground">
              {formatMoneyShort(entry.value, DEFAULT_CURRENCY)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { user, can } = useAuth();

  const overviewQuery = useQuery({ queryKey: qk.dashboard.overview, queryFn: getDashboardOverview });
  const funnelQuery = useQuery({ queryKey: qk.dashboard.salesFunnel, queryFn: () => getSalesFunnel() });
  const myWorkQuery = useQuery({ queryKey: qk.dashboard.myWork, queryFn: getMyWork });

  const overview = overviewQuery.data;
  const funnel = funnelQuery.data;
  const myWork = myWorkQuery.data;
  const loading = overviewQuery.isLoading;

  const headline = computeFunnelHeadline(overview?.leads, funnel?.quotations);
  const costVisible = overview?.cost_visible === true && can("view_margins");

  const trend = (overview?.revenue_trend ?? []).map((point) => ({
    label: point.label,
    revenue: toNumber(point.revenue),
    margin: point.margin !== undefined ? toNumber(point.margin) : undefined,
  }));

  const destinations = (overview?.top_destinations ?? []).slice(0, 6).map((d) => ({
    name: d.destination_name,
    revenue: toNumber(d.revenue),
    margin: d.estimated_margin !== undefined ? toNumber(d.estimated_margin) : undefined,
  }));

  return (
    <div className="space-y-5">
      <PageHeader
        title={`Welcome back${user ? `, ${user.full_name.split(" ")[0]}` : ""}`}
        description={overview ? `As of ${formatDate(overview.as_of, "dd MMM yyyy, h:mm a")}` : "Loading your day…"}
      />

      {/* The four metrics the client named explicitly: inquiries, quotes
          dispatched, pending response, conversions. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Total inquiries"
          value={headline.totalInquiries}
          icon={ClipboardList}
          tone="info"
          hint="this period"
          loading={loading || funnelQuery.isLoading}
          to="/leads"
        />
        <StatCard
          label="Quotes dispatched"
          value={headline.totalQuotesDispatched}
          icon={FileText}
          tone="default"
          hint="sent to a customer"
          loading={loading || funnelQuery.isLoading}
          to="/quotations"
        />
        <StatCard
          label="Pending response"
          value={headline.pendingResponse}
          icon={Clock}
          tone="warning"
          hint="awaiting customer decision"
          loading={loading || funnelQuery.isLoading}
          to="/quotations?expiring=1"
        />
        <StatCard
          label="Conversions"
          value={headline.conversions}
          icon={TrendingUp}
          tone="positive"
          hint="enquiries won"
          loading={loading || funnelQuery.isLoading}
          to="/leads?status=won"
        />
      </div>

      {/* Money & operations at a glance */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Bookings this month"
          value={overview ? overview.this_month.booking_count : "—"}
          icon={Briefcase}
          hint={overview ? `${formatMoneyShort(overview.this_month.booking_value)} value` : undefined}
          delta={overview?.this_month.vs_last_month_pct ?? undefined}
          deltaLabel="vs last month"
          loading={loading}
        />
        <StatCard
          label="Collections this month"
          value={overview ? <MoneyText value={overview.this_month.collections} short /> : "—"}
          icon={Wallet}
          tone="positive"
          loading={loading}
          to="/payments"
        />
        <StatCard
          label="Receivable outstanding"
          value={overview ? <MoneyText value={overview.money.receivable.outstanding} short /> : "—"}
          icon={Wallet}
          tone="warning"
          hint={overview ? `${overview.money.receivable.booking_count} booking(s)` : undefined}
          loading={loading}
          to="/receivables"
        />
        {costVisible && overview?.this_month.estimated_margin !== undefined ? (
          <StatCard
            label="Estimated margin"
            value={<MoneyText value={overview.this_month.estimated_margin} short colored />}
            icon={TrendingUp}
            tone="positive"
            hint={overview.this_month.margin_pct !== undefined ? `${overview.this_month.margin_pct.toFixed(1)}% margin` : undefined}
            loading={loading}
            to="/profit-loss"
          />
        ) : (
          <StatCard
            label="Departures next 14 days"
            value={overview ? overview.upcoming.length : "—"}
            icon={Plane}
            loading={loading}
          />
        )}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Revenue trend</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-64 w-full" />
            ) : trend.length === 0 ? (
              <EmptyState compact title="No revenue yet" description="Confirmed bookings will appear here." />
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart data={trend} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                  <defs>
                    <linearGradient id="revenueFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={CHART_COLORS[0]} stopOpacity={0.25} />
                      <stop offset="100%" stopColor={CHART_COLORS[0]} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border" />
                  <XAxis
                    dataKey="label"
                    tickLine={false}
                    axisLine={false}
                    className="text-xs fill-muted-foreground"
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    width={56}
                    className="text-xs fill-muted-foreground"
                    tickFormatter={(v: number) => formatMoneyShort(v)}
                  />
                  <Tooltip content={<ChartTooltip />} />
                  {costVisible && trend.some((t) => t.margin !== undefined) && <Legend iconType="circle" />}
                  <Area
                    type="monotone"
                    dataKey="revenue"
                    name="Revenue"
                    stroke={CHART_COLORS[0]}
                    strokeWidth={2}
                    fill="url(#revenueFill)"
                    dot={{ r: 3, strokeWidth: 0, fill: CHART_COLORS[0] }}
                    activeDot={{ r: 5 }}
                  />
                  {costVisible && (
                    <Area
                      type="monotone"
                      dataKey="margin"
                      name="Margin"
                      stroke={CHART_COLORS[1]}
                      strokeWidth={2}
                      fill="none"
                      dot={{ r: 3, strokeWidth: 0, fill: CHART_COLORS[1] }}
                      activeDot={{ r: 5 }}
                    />
                  )}
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Top destinations</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-64 w-full" />
            ) : destinations.length === 0 ? (
              <EmptyState compact title="No bookings yet" />
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={destinations} layout="vertical" margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} className="stroke-border" />
                  <XAxis
                    type="number"
                    tickLine={false}
                    axisLine={false}
                    className="text-xs fill-muted-foreground"
                    tickFormatter={(v: number) => formatMoneyShort(v)}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    tickLine={false}
                    axisLine={false}
                    width={90}
                    className="text-xs fill-muted-foreground"
                  />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="revenue" name="Revenue" fill={CHART_COLORS[0]} radius={[0, 4, 4, 0]} maxBarSize={18} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Upcoming departures + Alerts */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CalendarClock className="h-4 w-4 text-muted-foreground" aria-hidden />
              Upcoming departures
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {loading ? (
              <div className="space-y-2">
                {Array.from({ length: 4 }, (_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : !overview || overview.upcoming.length === 0 ? (
              <EmptyState compact title="Nothing departing in the next 14 days" />
            ) : (
              overview.upcoming.slice(0, 8).map((dep) => (
                <Link
                  key={dep.id}
                  to={`/bookings/${dep.id}`}
                  className="flex items-center justify-between gap-3 rounded-md px-2 py-2 text-sm transition-colors hover:bg-accent/50"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      {dep.booking_no} · {dep.customer_name ?? dep.lead_pax_name ?? "—"}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {dep.destination_name ?? "—"} · {formatDate(dep.travel_from)} · {dep.days_to_departure}d away
                    </p>
                  </div>
                  <MoneyText value={dep.outstanding} short className="shrink-0 text-xs" muted />
                </Link>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-muted-foreground" aria-hidden />
              Alerts
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {loading ? (
              <div className="space-y-2">
                {Array.from({ length: 4 }, (_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : !overview || overview.alerts.length === 0 ? (
              <EmptyState compact title="No alerts" description="Nothing needs attention right now." />
            ) : (
              overview.alerts.slice(0, 8).map((alert, index) => {
                const meta = ALERT_META[alert.kind];
                const Icon = meta.icon;
                return (
                  <Link
                    key={`${alert.kind}-${alert.entity_id}-${index}`}
                    to={alertHref(alert)}
                    className="flex items-start gap-3 rounded-md px-2 py-2 text-sm transition-colors hover:bg-accent/50"
                  >
                    <span
                      className={
                        alert.severity === "critical"
                          ? "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-status-overdue-bg text-status-overdue"
                          : "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-status-pending-bg text-status-pending"
                      }
                    >
                      <Icon className="h-3.5 w-3.5" aria-hidden />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate font-medium">{alert.title}</p>
                      <p className="truncate text-xs text-muted-foreground">{alert.detail}</p>
                    </div>
                  </Link>
                );
              })
            )}
          </CardContent>
        </Card>
      </div>

      {/* My Work */}
      <Card>
        <CardHeader>
          <CardTitle>My work</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-medium">Leads due today</h3>
                <Badge variant="secondary">{myWork?.counts.leads_due_today ?? 0}</Badge>
              </div>
              <div className="space-y-1.5">
                {myWorkQuery.isLoading ? (
                  <Skeleton className="h-16 w-full" />
                ) : !myWork || myWork.leads_due_today.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Nothing due — nice work.</p>
                ) : (
                  myWork.leads_due_today.slice(0, 6).map((lead) => (
                    <Link
                      key={lead.id}
                      to={`/leads/${lead.id}`}
                      className="block rounded-md px-2 py-1.5 text-xs transition-colors hover:bg-accent/50"
                    >
                      <p className="truncate font-medium text-foreground">{lead.contact_name}</p>
                      <p className="truncate text-muted-foreground">
                        {lead.destination_name ?? "—"} ·{" "}
                        {lead.next_followup_at ? relativeTime(lead.next_followup_at) : "no follow-up set"}
                      </p>
                    </Link>
                  ))
                )}
              </div>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-medium">Departing this week</h3>
                <Badge variant="secondary">{myWork?.counts.bookings_this_week ?? 0}</Badge>
              </div>
              <div className="space-y-1.5">
                {myWorkQuery.isLoading ? (
                  <Skeleton className="h-16 w-full" />
                ) : !myWork || myWork.bookings_this_week.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No departures assigned to you this week.</p>
                ) : (
                  myWork.bookings_this_week.slice(0, 6).map((booking) => (
                    <Link
                      key={booking.id}
                      to={`/bookings/${booking.id}`}
                      className="block rounded-md px-2 py-1.5 text-xs transition-colors hover:bg-accent/50"
                    >
                      <p className="truncate font-medium text-foreground">
                        {booking.booking_no} · {booking.customer_name ?? "—"}
                      </p>
                      <p className="truncate text-muted-foreground">
                        {booking.destination_name ?? "—"} · {formatDate(booking.travel_from)}
                      </p>
                    </Link>
                  ))
                )}
              </div>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-medium">My draft quotes</h3>
                <Badge variant="secondary">{myWork?.counts.open_quotations ?? 0}</Badge>
              </div>
              <div className="space-y-1.5">
                {myWorkQuery.isLoading ? (
                  <Skeleton className="h-16 w-full" />
                ) : !myWork || myWork.open_quotations.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Nothing waiting on you.</p>
                ) : (
                  myWork.open_quotations.slice(0, 6).map((quote) => (
                    <Fragment key={quote.id}>
                      <Link
                        to={`/quotations/${quote.id}`}
                        className="block rounded-md px-2 py-1.5 text-xs transition-colors hover:bg-accent/50"
                      >
                        <p className="truncate font-medium text-foreground">
                          {quote.quote_no} · {quote.customer_name ?? "—"}
                        </p>
                        <p className="flex items-center gap-1.5 truncate text-muted-foreground">
                          <MoneyText value={quote.grand_total} short />
                          <span aria-hidden>·</span>
                          <MapPin className="h-3 w-3" aria-hidden />
                          {quote.status}
                        </p>
                      </Link>
                    </Fragment>
                  ))
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
