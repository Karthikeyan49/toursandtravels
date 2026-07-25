import { apiGet, apiList, apiPost, apiPut, buildQuery } from "@/lib/api/client";
import type { Decimal, Flag, ISODate, ISODateTime, SortDir } from "@/lib/api/common";
import type { BookingDetail, HotelCategory } from "@/lib/api/bookings";
import type { CompanyProfile } from "@/lib/api/settings";
import type { QuotationOptions } from "@/lib/api/quotationOptions";

/**
 * Package Type vs Independent split (api/migrations/009_client_vocab_patch.sql
 * — `quotations.quote_type`). Same vocabulary as `bookings.booking_type` so a
 * converted booking always agrees with the quote it came from.
 */
export const QUOTE_TYPES = [
  "package",
  "custom",
  "hotel_only",
  "transport_only",
  "activity_only",
  "visa_only",
] as const;
export type QuoteType = (typeof QUOTE_TYPES)[number];

/**
 * Quotations and their revision chain.
 *
 * A sent quote is immutable: changing the price means `revise()`, which opens a
 * new version under the same `quote_no`. Totals are always recomputed from the
 * line items server-side.
 */

export const QUOTATION_STATUSES = [
  "draft",
  "sent",
  "viewed",
  "revised",
  "accepted",
  "rejected",
  "expired",
] as const;
export type QuotationStatus = (typeof QUOTATION_STATUSES)[number];

/** Only these may be edited or re-priced in place. */
export const QUOTATION_EDITABLE_STATUSES: readonly QuotationStatus[] = ["draft", "revised"];

export const QUOTATION_ITEM_TYPES = [
  "package",
  "hotel",
  "transport",
  "activity",
  "flight",
  "train",
  "bus",
  "visa",
  "insurance",
  "meal",
  "guide",
  "other",
] as const;
export type QuotationItemType = (typeof QUOTATION_ITEM_TYPES)[number];

/** Mirrors Quotation::TRANSITIONS. */
export const QUOTATION_TRANSITIONS: Record<QuotationStatus, readonly QuotationStatus[]> = {
  draft: ["sent"],
  sent: ["viewed", "revised", "accepted", "rejected", "expired"],
  viewed: ["revised", "accepted", "rejected", "expired"],
  revised: ["sent", "rejected"],
  accepted: [],
  rejected: ["revised"],
  expired: ["revised"],
};

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

export interface Quotation {
  id: number;
  quote_no: string;
  version: number;
  parent_quote_id: number | null;
  lead_id: number | null;
  customer_id: number | null;
  agency_id: number | null;
  package_id: number | null;
  /** Full Package vs Independent/Individual toggle. */
  quote_type: QuoteType;
  departure_id: number | null;
  destination_id: number | null;
  title: string;
  quote_date: ISODate;
  valid_until: ISODate | null;
  travel_from: ISODate | null;
  travel_to: ISODate | null;
  nights: number;
  adults: number;
  children: number;
  infants: number;
  hotel_category: HotelCategory | null;
  currency: string;
  subtotal: Decimal;
  discount_amount: Decimal;
  taxable_amount: Decimal;
  gst_pct: Decimal;
  gst_amount: Decimal;
  tcs_amount: Decimal;
  grand_total: Decimal;
  /** Internal. Stripped for roles without `view_margins`. */
  cost_total?: Decimal;
  /** Internal. Stripped for roles without `view_margins`. */
  margin_amount?: Decimal;
  inclusions: string | null;
  exclusions: string | null;
  terms: string | null;
  notes: string | null;
  status: QuotationStatus;
  previous_status: string | null;
  sent_at: ISODateTime | null;
  accepted_at: ISODateTime | null;
  rejected_reason: string | null;
  converted_booking_id: number | null;
  owner_id: number | null;
  created_at: ISODateTime;
  updated_at: ISODateTime;
  created_by: number | null;
}

export interface QuotationListItem extends Quotation {
  customer_name: string | null;
  customer_phone: string | null;
  destination_name: string | null;
  package_name: string | null;
  owner_name: string | null;
  lead_no: string | null;
}

export interface QuotationItem {
  id: number;
  quotation_id: number;
  item_type: QuotationItemType;
  ref_id: number | null;
  description: string;
  day_no: number | null;
  service_date: ISODate | null;
  quantity: Decimal;
  unit: string;
  /** Internal. Stripped for roles without `view_margins`. */
  unit_cost?: Decimal;
  unit_price: Decimal;
  /** Internal. Stripped for roles without `view_margins`. */
  line_cost?: Decimal;
  line_total: Decimal;
  /** Optional lines are quoted but excluded from the headline total. */
  is_optional: Flag;
  sort_order: number;
}

export interface QuotationDay {
  id: number;
  quotation_id: number;
  day_no: number;
  day_date: ISODate | null;
  title: string;
  description: string | null;
  hotel_id: number | null;
  hotel_name: string | null;
  meal_plan: string;
  hotel_display_name: string | null;
}

export interface QuotationRevisionRef {
  id: number;
  quote_no: string;
  version: number;
  quote_date: ISODate;
  grand_total: Decimal;
  status: QuotationStatus;
}

export interface QuotationDetail extends Quotation {
  customer_name: string | null;
  customer_phone: string | null;
  customer_email: string | null;
  customer_address: string | null;
  customer_city: string | null;
  customer_state: string | null;
  customer_gstin: string | null;
  destination_name: string | null;
  package_name: string | null;
  owner_name: string | null;
  items: QuotationItem[];
  days: QuotationDay[];
  revisions: QuotationRevisionRef[];
  company: CompanyProfile;
  /** The Dynamic Quotation Builder toggle set — embedded by Quotation::detail(). */
  options?: QuotationOptions;
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export type QuotationFilters = {
  page?: number;
  limit?: number;
  search?: string;
  sort?: string;
  dir?: SortDir;
  status?: QuotationStatus | readonly QuotationStatus[];
  customer_id?: number;
  lead_id?: number;
  owner_id?: number;
  from?: ISODate;
  to?: ISODate;
  /** Sent quotes lapsing within three days. */
  expiring?: boolean;
};

export interface QuotationInput {
  title: string;
  adults: number;
  lead_id?: number | null;
  customer_id?: number | null;
  agency_id?: number | null;
  package_id?: number | null;
  quote_type?: QuoteType;
  departure_id?: number | null;
  destination_id?: number | null;
  valid_until?: ISODate | null;
  travel_from?: ISODate | null;
  travel_to?: ISODate | null;
  children?: number;
  infants?: number;
  hotel_category?: HotelCategory | null;
  inclusions?: string | null;
  exclusions?: string | null;
  terms?: string | null;
  notes?: string | null;
  owner_id?: number | null;
}

export type QuotationUpdateInput = Partial<Omit<QuotationInput, "lead_id" | "agency_id" | "customer_id">>;

export interface QuotationItemInput {
  item_type: QuotationItemType;
  description: string;
  ref_id?: number | null;
  day_no?: number | null;
  service_date?: ISODate | null;
  quantity: number;
  unit?: string;
  unit_cost?: number;
  unit_price: number;
  is_optional?: boolean;
}

export interface SaveQuotationItemsInput {
  items: QuotationItemInput[];
  /** Only roles with `edit_prices` may change this. */
  discount_amount?: number;
}

export interface QuotationPriceFromPackageInput {
  occupancy?: "single" | "double" | "triple";
  children_with_bed?: number;
  children_no_bed?: number;
  extra_beds?: number;
}

export interface QuotationStatusInput {
  status: QuotationStatus;
  /** Required by the API when rejecting. */
  reason?: string;
}

// ---------------------------------------------------------------------------
// Calls
// ---------------------------------------------------------------------------

export async function listQuotations(params: QuotationFilters = {}) {
  return apiList<QuotationListItem>(`/quotations${buildQuery(params)}`);
}

export async function getQuotation(id: number) {
  return apiGet<QuotationDetail>(`/quotations/${id}`);
}

export async function createQuotation(input: QuotationInput) {
  return apiPost<QuotationDetail>("/quotations", input);
}

export async function updateQuotation(id: number, input: QuotationUpdateInput) {
  return apiPut<QuotationDetail>(`/quotations/${id}`, input);
}

export async function saveQuotationItems(id: number, input: SaveQuotationItemsInput) {
  return apiPut<QuotationDetail>(`/quotations/${id}/items`, input);
}

export async function priceQuotationFromPackage(id: number, input: QuotationPriceFromPackageInput = {}) {
  return apiPost<QuotationDetail>(`/quotations/${id}/price-from-package`, input);
}

export async function sendQuotation(id: number) {
  return apiPost<QuotationDetail>(`/quotations/${id}/send`);
}

export async function changeQuotationStatus(id: number, input: QuotationStatusInput) {
  return apiPost<QuotationDetail>(`/quotations/${id}/status`, input);
}

/** Opens a new version under the same quote_no and returns it. */
export async function reviseQuotation(id: number) {
  return apiPost<QuotationDetail>(`/quotations/${id}/revise`);
}

/** Accepts the quote and opens a draft booking from it. */
export async function convertQuotation(id: number) {
  return apiPost<BookingDetail>(`/quotations/${id}/convert`);
}
