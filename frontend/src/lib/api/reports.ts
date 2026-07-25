import { apiBlob, apiGet, buildQuery } from "@/lib/api/client";
import type { Decimal, ISODate } from "@/lib/api/common";

/**
 * Reporting hub. Every report accepts the same shape twice — once as the JSON
 * this module returns, once as a `?format=csv` download through Exporter —
 * so the screen and the export can never disagree. `exportReportCsv` is the
 * one function pages call for the download button; the `get*` functions feed
 * the on-screen tables.
 */

export type ReportPeriodParams = { from?: ISODate; to?: ISODate };

// ---------------------------------------------------------------------------
// Sales
// ---------------------------------------------------------------------------

export const SALES_GROUP_BY = [
  "period",
  "travel_month",
  "destination",
  "package",
  "staff",
  "source",
  "agency",
  "booking_type",
] as const;
export type SalesGroupBy = (typeof SALES_GROUP_BY)[number];

export interface SalesReportRow {
  dimension: string;
  booking_count: number;
  pax: number;
  subtotal: Decimal;
  discount: Decimal;
  net_revenue: Decimal;
  gst: Decimal;
  gross_revenue: Decimal;
  estimated_cost: Decimal;
  collected: Decimal;
  outstanding: Decimal;
  margin: Decimal;
  margin_pct: number;
  avg_booking: Decimal;
  revenue_per_pax: Decimal;
}

export interface SalesReport {
  period: { from: ISODate; to: ISODate; basis: "travel" | "booking" };
  group_by: SalesGroupBy;
  dimension_label: string;
  rows: SalesReportRow[];
  totals: {
    booking_count: number;
    pax: number;
    gross_revenue: Decimal;
    net_revenue: Decimal;
    estimated_cost: Decimal;
    margin: Decimal;
    collected: Decimal;
    outstanding: Decimal;
  };
}

export type SalesReportFilters = ReportPeriodParams & {
  group_by?: SalesGroupBy;
  date_basis?: "travel" | "booking";
  destination_id?: number;
  package_id?: number;
  owner_id?: number;
};

// ---------------------------------------------------------------------------
// Margin
// ---------------------------------------------------------------------------

export interface MarginReportRow {
  id: number;
  booking_no: string;
  booking_date: ISODate;
  travel_from: ISODate;
  travel_to: ISODate;
  adults: number;
  children: number;
  status: string;
  revenue: Decimal;
  grand_total: Decimal;
  estimated_cost: Decimal;
  agency_commission: Decimal;
  customer_name: string | null;
  destination_name: string | null;
  package_name: string | null;
  owner_name: string | null;
  billed_cost: Decimal;
  direct_expenses: Decimal;
  trip_sheet_cost: Decimal;
  actual_cost: Decimal;
  margin: Decimal;
  margin_pct: number;
  is_estimated: boolean;
  pax: number;
}

export interface MarginReport {
  period: { from: ISODate; to: ISODate };
  rows: MarginReportRow[];
  totals: {
    booking_count: number;
    revenue: Decimal;
    actual_cost: Decimal;
    margin: Decimal;
    margin_pct: number;
    loss_making: number;
  };
}

export type MarginReportFilters = ReportPeriodParams & {
  loss_making?: boolean;
  destination_id?: number;
  package_id?: number;
  owner_id?: number;
};

// ---------------------------------------------------------------------------
// Supplier performance
// ---------------------------------------------------------------------------

export interface SupplierPerformanceRow {
  id: number;
  code: string;
  supplier_name: string;
  supplier_type: string;
  rating: Decimal | null;
  phone: string | null;
  email: string | null;
  credit_days: number;
  destination_name: string | null;
  bill_count: number;
  billed_amount: Decimal;
  outstanding: Decimal;
  service_count: number;
  on_time_confirmations: number;
  on_time_pct: number | null;
  incident_count: number;
  serious_incident_count: number;
  incident_cost_impact: Decimal;
  incident_rate_pct: number | null;
  feedback_count: number;
}

export interface SupplierPerformanceReport {
  period: { from: ISODate; to: ISODate };
  suppliers: SupplierPerformanceRow[];
  totals: {
    supplier_count: number;
    billed_amount: Decimal;
    outstanding: Decimal;
    incidents: number;
  };
}

export type SupplierPerformanceFilters = ReportPeriodParams & {
  supplier_type?: string;
  destination_id?: number;
};

// ---------------------------------------------------------------------------
// Pax manifest
// ---------------------------------------------------------------------------

export interface PaxManifestDeparture {
  id: number;
  package_id: number;
  batch_code: string;
  departure_date: ISODate;
  return_date: ISODate;
  seats_total: number;
  seats_booked: number;
  seats_held: number;
  status: string;
  package_name: string;
  package_code: string;
  nights: number;
  days: number;
  destination_name: string | null;
  departure_city: string | null;
  tour_manager_name: string | null;
  tour_manager_phone: string | null;
}

export interface PaxManifestBooking {
  id: number;
  booking_no: string;
  adults: number;
  children: number;
  infants: number;
  status: string;
  payment_status: string;
  grand_total: Decimal;
  amount_paid: Decimal;
  outstanding: Decimal;
  customer_name: string | null;
  customer_phone: string | null;
}

export interface PaxManifestRow {
  booking_no: string;
  travel_from: ISODate;
  travel_to: ISODate;
  booking_status: string;
  booking_phone: string | null;
  emergency_contact: string | null;
  emergency_phone: string | null;
  special_requests: string | null;
  customer_name: string | null;
  pax_id: number;
  pax_no: number;
  title: string;
  first_name: string;
  last_name: string | null;
  full_name: string;
  pax_type: string;
  gender: string | null;
  date_of_birth: ISODate | null;
  age: number | null;
  phone: string | null;
  email: string | null;
  passport_no: string | null;
  passport_issue: ISODate | null;
  passport_expiry: ISODate | null;
  passport_country: string | null;
  visa_no: string | null;
  visa_status: string | null;
  visa_expiry: ISODate | null;
  meal_preference: string;
  medical_notes: string | null;
  is_lead_pax: 0 | 1;
  insurance_no: string | null;
  nationality: string | null;
  room_no: string | null;
  room_type_label: string | null;
  occupancy: string | null;
  document_ok: boolean;
}

export interface PaxManifest {
  departure: PaxManifestDeparture;
  bookings: PaxManifestBooking[];
  pax: PaxManifestRow[];
  summary: {
    booking_count: number;
    pax_count: number;
    adults: number;
    children: number;
    infants: number;
    seats_total: number;
    seats_free: number;
    meal_preferences: Record<string, number>;
    outstanding: Decimal;
    document_issues: number;
  };
}

// ---------------------------------------------------------------------------
// Outstanding
// ---------------------------------------------------------------------------

export type OutstandingBucket = "departed" | "due_now" | "due_30" | "later";

export interface OutstandingBookingRow {
  id: number;
  booking_no: string;
  booking_date: ISODate;
  travel_from: ISODate;
  travel_to: ISODate;
  status: string;
  payment_status: string;
  grand_total: Decimal;
  amount_paid: Decimal;
  outstanding: Decimal;
  days_to_departure: number;
  last_payment_at: string | null;
  customer_id: number;
  customer_name: string | null;
  customer_phone: string | null;
  customer_email: string | null;
  destination_name: string | null;
  owner_name: string | null;
  next_instalment_due: ISODate | null;
  bucket: OutstandingBucket;
}

export interface OutstandingInvoiceRow {
  id: number;
  invoice_no: string;
  invoice_date: ISODate;
  due_date: ISODate | null;
  grand_total: Decimal;
  amount_paid: Decimal;
  outstanding: Decimal;
  days_overdue: number | null;
  customer_name: string | null;
}

export interface OutstandingReport {
  balance_due_days_before: number;
  rows: OutstandingBookingRow[];
  buckets: Record<OutstandingBucket, Decimal>;
  totals: { booking_count: number; outstanding: Decimal };
  invoices: OutstandingInvoiceRow[];
}

export type OutstandingFilters = {
  customer_id?: number;
  owner_id?: number;
  overdue_only?: boolean;
};

// ---------------------------------------------------------------------------
// Lead source ROI
// ---------------------------------------------------------------------------

export interface LeadSourceRoiRow {
  source_id: number;
  source_name: string;
  is_paid: 0 | 1;
  lead_count: number;
  won_count: number;
  lost_count: number;
  open_count: number;
  enquiry_pax: number;
  potential_value: Decimal;
  quote_count: number;
  quoted_lead_count: number;
  booking_count: number;
  revenue: Decimal;
  estimated_margin: Decimal;
  quote_rate_pct: number;
  win_rate_pct: number;
  revenue_per_lead: Decimal;
  allocated_spend: Decimal;
  roi_pct: number | null;
  cost_per_acquisition: Decimal | null;
}

export interface LeadSourceRoiReport {
  period: { from: ISODate; to: ISODate };
  marketing_spend: Decimal;
  spend_note: string;
  rows: LeadSourceRoiRow[];
  totals: { lead_count: number; won_count: number; booking_count: number; revenue: Decimal };
}

// ---------------------------------------------------------------------------
// Calls
// ---------------------------------------------------------------------------

export async function getSalesReport(params: SalesReportFilters = {}) {
  return apiGet<SalesReport>(`/reports/sales${buildQuery(params)}`);
}

export async function getMarginReport(params: MarginReportFilters = {}) {
  return apiGet<MarginReport>(`/reports/margin${buildQuery(params)}`);
}

export async function getSupplierPerformanceReport(params: SupplierPerformanceFilters = {}) {
  return apiGet<SupplierPerformanceReport>(`/reports/supplier-performance${buildQuery(params)}`);
}

export async function getPaxManifest(departureId: number) {
  return apiGet<PaxManifest>(`/reports/pax-manifest${buildQuery({ departure_id: departureId })}`);
}

export async function getOutstandingReport(params: OutstandingFilters = {}) {
  return apiGet<OutstandingReport>(`/reports/outstanding${buildQuery(params)}`);
}

export async function getLeadSourceRoiReport(params: ReportPeriodParams = {}) {
  return apiGet<LeadSourceRoiReport>(`/reports/lead-source-roi${buildQuery(params)}`);
}

/** Report slugs, matched 1:1 to their GET path under /reports. */
export const REPORT_ENDPOINTS = {
  sales: "/reports/sales",
  margin: "/reports/margin",
  "supplier-performance": "/reports/supplier-performance",
  "pax-manifest": "/reports/pax-manifest",
  outstanding: "/reports/outstanding",
  "lead-source-roi": "/reports/lead-source-roi",
} as const;
export type ReportSlug = keyof typeof REPORT_ENDPOINTS;

/** Downloads the same rows the screen shows, as CSV — wire this to the Export button. */
export async function exportReportCsv(
  slug: ReportSlug,
  params: Record<string, string | number | boolean | undefined> = {},
): Promise<Blob> {
  return apiBlob(`${REPORT_ENDPOINTS[slug]}${buildQuery({ ...params, format: "csv" })}`);
}
