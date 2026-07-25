import { apiDelete, apiGet, apiList, apiPost, apiPut, buildQuery } from "@/lib/api/client";
import type { Decimal, Flag, ISODate, ISODateTime, SortDir } from "@/lib/api/common";
import type { DestinationScope } from "@/lib/api/destinations";

/**
 * Rate-slab hotel category. Deliberately NOT the narrower `HotelCategory` from
 * `bookings.ts` (which still lacks 2-Star as of this writing) — migration
 * 009_client_vocab_patch.sql widened `package_prices.hotel_category` to this
 * full 6-value set per the client's explicit Budget/2-Star/3/4/5-Star list.
 */
export const PACKAGE_HOTEL_CATEGORIES = ["budget", "2star", "3star", "4star", "5star", "luxury"] as const;
export type PackageHotelCategory = (typeof PACKAGE_HOTEL_CATEGORIES)[number];

/**
 * Tour packages: the itinerary template, the rate-slab card and fixed-departure
 * batches with seat inventory.
 *
 * Availability is always `seats_total - seats_booked - seats_held`, computed by
 * the API; the client never derives it from a stale count.
 */

export const PACKAGE_TYPES = [
  "fixed_departure",
  "customised",
  "fit",
  "group",
  "honeymoon",
  "pilgrimage",
  "corporate",
  "mice",
] as const;
export type PackageType = (typeof PACKAGE_TYPES)[number];

export const PACKAGE_STATUSES = ["draft", "active", "archived"] as const;
export type PackageStatus = (typeof PACKAGE_STATUSES)[number];

export const DAY_MEAL_PLANS = ["none", "B", "L", "D", "BL", "BD", "LD", "BLD"] as const;
export type DayMealPlan = (typeof DAY_MEAL_PLANS)[number];

export const DAY_ITEM_TYPES = ["hotel", "activity", "transport", "flight", "meal", "other"] as const;
export type DayItemType = (typeof DAY_ITEM_TYPES)[number];

export const DEPARTURE_STATUSES = ["open", "filling", "full", "closed", "departed", "cancelled"] as const;
export type DepartureStatus = (typeof DEPARTURE_STATUSES)[number];

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

export interface Package {
  id: number;
  code: string;
  name: string;
  destination_id: number;
  package_type: PackageType;
  scope: DestinationScope;
  nights: number;
  days: number;
  min_pax: number;
  /** 0 means unlimited. */
  max_pax: number;
  summary: string | null;
  description: string | null;
  inclusions: string | null;
  exclusions: string | null;
  terms: string | null;
  cancellation_policy: string | null;
  hero_image: string | null;
  /** Indicative only — the authoritative price comes from the slab card. */
  base_price_adult: Decimal;
  currency: string;
  markup_pct: Decimal;
  gst_pct: Decimal;
  status: PackageStatus;
  is_deleted: Flag;
  created_at: ISODateTime;
  updated_at: ISODateTime;
  created_by: number | null;
}

export interface PackageListItem extends Package {
  destination_name: string | null;
  open_departures: number;
  booking_count: number;
}

export interface PackageDay {
  id: number;
  package_id: number;
  day_no: number;
  title: string;
  description: string | null;
  city_id: number | null;
  overnight_city_id: number | null;
  meal_plan: DayMealPlan;
  distance_km: number | null;
  drive_hours: Decimal | null;
  image_path: string | null;
  city_name: string | null;
  overnight_city_name: string | null;
}

export interface PackageDayItem {
  id: number;
  package_day_id: number;
  item_type: DayItemType;
  ref_id: number | null;
  label: string;
  quantity: Decimal;
  /** Stripped for roles without `view_costs`. */
  unit_cost?: Decimal;
  is_optional: Flag;
  sort_order: number;
}

export interface PackagePrice {
  id: number;
  package_id: number;
  label: string;
  hotel_category: PackageHotelCategory;
  pax_from: number;
  pax_to: number;
  valid_from: ISODate;
  valid_to: ISODate;
  currency: string;
  /** Net supplier cost. Stripped for roles without `view_costs`. */
  cost_per_adult?: Decimal;
  price_single: Decimal;
  /** Per person on twin sharing. */
  price_double: Decimal;
  price_triple: Decimal;
  price_child_bed: Decimal;
  price_child_nobed: Decimal;
  price_infant: Decimal;
  extra_bed_price: Decimal;
  is_active: Flag;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

export interface Departure {
  id: number;
  package_id: number;
  batch_code: string;
  departure_date: ISODate;
  return_date: ISODate;
  departure_city_id: number | null;
  seats_total: number;
  seats_booked: number;
  seats_held: number;
  price_override: Decimal | null;
  tour_manager_id: number | null;
  status: DepartureStatus;
  previous_status: string | null;
  notes: string | null;
  created_at: ISODateTime;
  updated_at: ISODateTime;
  created_by: number | null;
  seats_available: number;
  tour_manager_name: string | null;
}

/** GET /departures — the cross-package board, with package context joined in. */
export interface DepartureBoardRow extends Departure {
  fill_pct: Decimal | null;
  package_name: string;
  package_code: string;
  nights: number;
  destination_name: string | null;
  days_to_departure: number;
}

export interface PackageDetail extends Package {
  days: PackageDay[];
  day_items: PackageDayItem[];
  prices: PackagePrice[];
  departures: Departure[];
}

export interface PackageOption {
  id: number;
  code: string;
  name: string;
  nights: number;
  days: number;
  destination_id: number;
  base_price_adult: Decimal;
  gst_pct: Decimal;
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export type PackageFilters = {
  page?: number;
  limit?: number;
  search?: string;
  sort?: string;
  dir?: SortDir;
  destination_id?: number;
  package_type?: PackageType;
  scope?: DestinationScope;
  status?: PackageStatus;
  nights_min?: number;
  nights_max?: number;
};

export type DepartureFilters = {
  page?: number;
  limit?: number;
  from?: ISODate;
  to?: ISODate;
  status?: DepartureStatus;
  package_id?: number;
  available_only?: boolean;
};

export interface PackageInput {
  name: string;
  destination_id: number;
  code?: string | null;
  package_type?: PackageType;
  scope?: DestinationScope;
  nights?: number;
  days?: number;
  min_pax?: number;
  max_pax?: number;
  summary?: string | null;
  description?: string | null;
  inclusions?: string | null;
  exclusions?: string | null;
  terms?: string | null;
  cancellation_policy?: string | null;
  hero_image?: string | null;
  base_price_adult?: number;
  currency?: string;
  markup_pct?: number;
  gst_pct?: number;
}

export type PackageUpdateInput = Partial<PackageInput>;

export interface PackageDayInput {
  day_no?: number;
  title: string;
  description?: string | null;
  city_id?: number | null;
  overnight_city_id?: number | null;
  meal_plan?: DayMealPlan;
  distance_km?: number | null;
  drive_hours?: number | null;
}

export interface PackagePriceInput {
  valid_from: ISODate;
  valid_to: ISODate;
  price_double: number;
  label?: string;
  hotel_category?: PackageHotelCategory;
  pax_from?: number;
  pax_to?: number;
  currency?: string;
  cost_per_adult?: number;
  price_single?: number;
  price_triple?: number;
  price_child_bed?: number;
  price_child_nobed?: number;
  price_infant?: number;
  extra_bed_price?: number;
}

export interface DepartureInput {
  departure_date: ISODate;
  seats_total: number;
  batch_code?: string | null;
  return_date?: ISODate | null;
  departure_city_id?: number | null;
  price_override?: number | null;
  tour_manager_id?: number | null;
  notes?: string | null;
}

// ---------------------------------------------------------------------------
// Calls
// ---------------------------------------------------------------------------

export async function listPackages(params: PackageFilters = {}) {
  return apiList<PackageListItem>(`/packages${buildQuery(params)}`);
}

export async function listPackageOptions(destinationId?: number) {
  return apiGet<PackageOption[]>(`/packages/options${buildQuery({ destination_id: destinationId })}`);
}

export async function getPackage(id: number) {
  return apiGet<PackageDetail>(`/packages/${id}`);
}

export async function createPackage(input: PackageInput) {
  return apiPost<PackageDetail>("/packages", input);
}

export async function updatePackage(id: number, input: PackageUpdateInput) {
  return apiPut<PackageDetail>(`/packages/${id}`, input);
}

/** Replaces the whole itinerary; day numbers are reassigned from the order. */
export async function savePackageItinerary(id: number, days: PackageDayInput[]) {
  return apiPut<PackageDetail>(`/packages/${id}/itinerary`, { days });
}

export async function createPackagePrice(packageId: number, input: PackagePriceInput) {
  return apiPost<PackagePrice>(`/packages/${packageId}/prices`, input);
}

/** Deactivates rather than deletes, so historic quotes keep resolving. */
export async function deactivatePackagePrice(packageId: number, priceId: number) {
  return apiDelete<null>(`/packages/${packageId}/prices/${priceId}`);
}

export async function createDeparture(packageId: number, input: DepartureInput) {
  return apiPost<Departure>(`/packages/${packageId}/departures`, input);
}

/** Requires an itinerary and at least one live rate slab. */
export async function publishPackage(id: number) {
  return apiPost<PackageDetail>(`/packages/${id}/publish`);
}

export async function archivePackage(id: number) {
  return apiPost<null>(`/packages/${id}/archive`);
}

export async function listDepartures(params: DepartureFilters = {}) {
  return apiList<DepartureBoardRow>(`/departures${buildQuery(params)}`);
}
