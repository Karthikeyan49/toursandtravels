import { apiGet, buildQuery } from "@/lib/api/client";
import type { Decimal, ISODate, ISODateTime, Severity } from "@/lib/api/common";
import type { LeadPriority, LeadStatus } from "@/lib/api/leads";

/**
 * The home screen: `DashboardController::overview()` answers the whole page in
 * one request, `salesFunnel()` backs the pipeline chart on the same page (and a
 * dedicated funnel view later) and `myWork()` is the signed-in user's personal
 * queue.
 *
 * Field shapes mirror the PHP exactly. A handful of aggregate columns come
 * straight off a raw `Database::fetchAll()` row with no `(int)`/`(float)` cast
 * in the controller — those are typed `Decimal` (not `number`) because PDO can
 * hand them back as numeric strings, same reasoning as every other module.
 * Fields the controller explicitly casts (`(int) $x`, PHP `round()`) are typed
 * `number`.
 */

// ---------------------------------------------------------------------------
// GET /dashboard/overview
// ---------------------------------------------------------------------------

export interface TodayDeparture {
  id: number;
  booking_no: string;
  lead_pax_name: string | null;
  contact_phone: string | null;
  adults: number;
  children: number;
  travel_from: ISODate;
  travel_to: ISODate;
  payment_status: string;
  outstanding: Decimal;
  customer_name: string | null;
  destination_name: string | null;
}

export interface TodayArrival {
  id: number;
  booking_no: string;
  lead_pax_name: string | null;
  contact_phone: string | null;
  adults: number;
  children: number;
  travel_from: ISODate;
  travel_to: ISODate;
  customer_name: string | null;
  destination_name: string | null;
}

export interface TodayBlock {
  date: ISODate;
  departures: TodayDeparture[];
  arrivals: TodayArrival[];
  departure_count: number;
  arrival_count: number;
  bookings_on_road: number;
  pax_on_road: number;
  infants_on_road: number;
  collections_today: Decimal;
  daysheets_with_issues: number;
}

export interface MonthBlock {
  from: ISODate;
  to: ISODate;
  booking_count: number;
  booking_value: Decimal;
  pax: number;
  /** Absent for roles without `view_costs`/`view_margins`. */
  estimated_cost?: Decimal;
  estimated_margin?: Decimal;
  margin_pct?: number;
  cancelled_count: number;
  cancelled_value: Decimal;
  collections: Decimal;
  vs_last_month_pct: number | null;
}

export interface LeadStatusCount {
  status: LeadStatus;
  lead_count: Decimal;
  potential_value: Decimal;
}

export interface LeadBlock {
  by_status: LeadStatusCount[];
  total: number;
  won: number;
  open: number;
  conversion_rate_pct: number;
  overdue_followups: number;
  unassigned: number;
}

export interface ReceivableBlock {
  outstanding: Decimal;
  booking_count: number;
  due_before_departure: Decimal;
}

export interface PayableBlock {
  outstanding: Decimal;
  bill_count: number;
  due_this_week: Decimal;
  overdue: Decimal;
}

export interface MoneyBlock {
  receivable: ReceivableBlock;
  /** Absent for roles without `view_costs`. */
  payable?: PayableBlock;
  /** Absent for roles without `view_costs`. */
  unapproved_expenses?: Decimal;
}

export interface UpcomingDeparture {
  id: number;
  booking_no: string;
  travel_from: ISODate;
  travel_to: ISODate;
  status: string;
  payment_status: string;
  adults: number;
  children: number;
  infants: number;
  lead_pax_name: string | null;
  outstanding: Decimal;
  days_to_departure: number;
  customer_name: string | null;
  customer_phone: string | null;
  destination_name: string | null;
  package_name: string | null;
  unconfirmed_services: number;
}

export interface TopDestination {
  id: number;
  destination_name: string;
  scope: string;
  booking_count: Decimal;
  pax: Decimal;
  revenue: Decimal;
  /** Absent for roles without `view_costs`. */
  estimated_margin?: Decimal;
}

export interface RevenueTrendPoint {
  period: string;
  label: string;
  booking_count: number;
  pax: number;
  revenue: Decimal;
  /** Absent for roles without `view_costs`. */
  cost?: Decimal;
  /** Absent for roles without `view_costs`. */
  margin?: Decimal;
}

export type IncidentSeverity = "critical" | "high" | "medium" | "low";

export interface OpenIncident {
  id: number;
  booking_id: number;
  incident_date: ISODate;
  category: string;
  severity: IncidentSeverity;
  title: string;
  status: string;
  /** Absent for roles without `view_costs`. */
  cost_impact?: Decimal;
  booking_no: string;
  supplier_name: string | null;
  assigned_to_name: string | null;
}

export type AlertKind = "payment_due" | "doc_expiring" | "lead_idle" | "vehicle_doc_expiring";

export interface DashboardAlert {
  kind: AlertKind;
  severity: Severity;
  title: string;
  detail: string;
  entity_type: "booking" | "lead" | "vehicle";
  entity_id: number;
}

export interface DashboardOverview {
  as_of: ISODateTime;
  today: TodayBlock;
  this_month: MonthBlock;
  leads: LeadBlock;
  money: MoneyBlock;
  upcoming: UpcomingDeparture[];
  top_destinations: TopDestination[];
  revenue_trend: RevenueTrendPoint[];
  open_incidents: OpenIncident[];
  alerts: DashboardAlert[];
  /** True when this role sees cost/margin figures at all. */
  cost_visible: boolean;
}

// ---------------------------------------------------------------------------
// GET /dashboard/sales-funnel
// ---------------------------------------------------------------------------

export interface FunnelStage {
  stage: string;
  count: number;
  value: Decimal | null;
  conversion_from_previous_pct: number;
  conversion_from_top_pct: number;
}

export interface FunnelPipelineRow {
  status: LeadStatus;
  lead_count: Decimal;
  potential_value: Decimal;
}

export interface FunnelQuotationStatusRow {
  status: string;
  quote_count: Decimal;
  quote_value: Decimal;
}

export interface FunnelSourceRow {
  source: string;
  lead_count: Decimal;
  won_count: Decimal;
  win_rate_pct: Decimal;
}

export interface FunnelOwnerRow {
  owner: string;
  lead_count: Decimal;
  won_count: Decimal;
  win_rate_pct: Decimal;
}

export interface SalesFunnel {
  period: { from: ISODate; to: ISODate };
  stages: FunnelStage[];
  pipeline: FunnelPipelineRow[];
  quotations: FunnelQuotationStatusRow[];
  by_source: FunnelSourceRow[];
  by_owner: FunnelOwnerRow[];
}

export type SalesFunnelFilters = {
  from?: ISODate;
  to?: ISODate;
  assigned_to?: number;
};

// ---------------------------------------------------------------------------
// GET /dashboard/my-work
// ---------------------------------------------------------------------------

export interface MyLeadDue {
  id: number;
  lead_no: string;
  contact_name: string;
  phone: string;
  status: LeadStatus;
  priority: LeadPriority;
  next_followup_at: ISODateTime | null;
  travel_date: ISODate | null;
  destination_name: string | null;
  hours_overdue: Decimal | null;
}

export interface MyBookingThisWeek {
  id: number;
  booking_no: string;
  travel_from: ISODate;
  travel_to: ISODate;
  status: string;
  payment_status: string;
  adults: number;
  children: number;
  outstanding: Decimal;
  days_to_departure: number;
  customer_name: string | null;
  customer_phone: string | null;
  destination_name: string | null;
}

export interface MyDraftQuote {
  id: number;
  quote_no: string;
  version: number;
  title: string;
  quote_date: ISODate;
  valid_until: ISODate | null;
  grand_total: Decimal;
  status: string;
  customer_name: string | null;
  days_to_expiry: number | null;
}

export interface MyDaysheet {
  id: number;
  booking_id: number;
  sheet_date: ISODate;
  day_no: number;
  status: string;
  summary: string | null;
  booking_no: string;
  lead_pax_name: string | null;
  contact_phone: string | null;
}

export interface MyWork {
  leads_due_today: MyLeadDue[];
  bookings_this_week: MyBookingThisWeek[];
  open_quotations: MyDraftQuote[];
  daysheets_today: MyDaysheet[];
  unread_notifications: number;
  counts: {
    leads_due_today: number;
    bookings_this_week: number;
    open_quotations: number;
    daysheets_today: number;
  };
}

// ---------------------------------------------------------------------------
// Calls
// ---------------------------------------------------------------------------

export async function getDashboardOverview() {
  return apiGet<DashboardOverview>("/dashboard/overview");
}

export async function getSalesFunnel(params: SalesFunnelFilters = {}) {
  return apiGet<SalesFunnel>(`/dashboard/sales-funnel${buildQuery(params)}`);
}

export async function getMyWork() {
  return apiGet<MyWork>("/dashboard/my-work");
}
