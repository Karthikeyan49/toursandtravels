import { apiGet, apiList, apiPost, apiPut, buildQuery } from "@/lib/api/client";
import type { Decimal, Flag, ISODate, ISODateTime, Severity, SortDir } from "@/lib/api/common";
import type { Payment } from "@/lib/api/payments";
import type { BookingOptions } from "@/lib/api/bookingOptions";
import type { TravelLeg } from "@/lib/api/travelLegs";

/**
 * Bookings: the centre of the system. Everything below the header row —
 * passengers, service lines, rooms, payments, vouchers, transport — hangs off
 * `GET /bookings/{id}`, which answers the whole detail screen in one call.
 *
 * Money is never client-supplied: totals are recomputed server-side from the
 * service lines on every save, and the cancellation charge comes from the
 * policy slab, not from the form.
 */

export const BOOKING_STATUSES = [
  "draft",
  "confirmed",
  "vouchered",
  "in_progress",
  "completed",
  "cancelled",
  "no_show",
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const BOOKING_PAYMENT_STATUSES = [
  "unpaid",
  "advance_paid",
  "partially_paid",
  "paid",
  "refunded",
  "overpaid",
] as const;
export type BookingPaymentStatus = (typeof BOOKING_PAYMENT_STATUSES)[number];

export const BOOKING_TYPES = [
  "package",
  "custom",
  "hotel_only",
  "transport_only",
  "activity_only",
  "visa_only",
] as const;
export type BookingType = (typeof BOOKING_TYPES)[number];

export const SERVICE_TYPES = [
  "hotel",
  "transport",
  "activity",
  "flight",
  "train",
  "bus",
  "visa",
  "insurance",
  "guide",
  "meal",
  "other",
] as const;
export type ServiceType = (typeof SERVICE_TYPES)[number];

export const SUPPLIER_STATUSES = [
  "pending",
  "requested",
  "confirmed",
  "waitlisted",
  "cancelled",
  "no_show",
] as const;
export type SupplierStatus = (typeof SUPPLIER_STATUSES)[number];

export const PAX_TITLES = ["Mr", "Mrs", "Ms", "Mstr", "Dr", "Prof"] as const;
export type PaxTitle = (typeof PAX_TITLES)[number];

export const PAX_TYPES = ["adult", "child", "infant"] as const;
export type PaxType = (typeof PAX_TYPES)[number];

export const GENDERS = ["male", "female", "other"] as const;
export type Gender = (typeof GENDERS)[number];

export const VISA_STATUSES = ["not_required", "pending", "applied", "approved", "rejected"] as const;
export type VisaStatus = (typeof VISA_STATUSES)[number];

export const MEAL_PREFERENCES = ["none", "veg", "non_veg", "jain", "vegan", "halal"] as const;
export type MealPreference = (typeof MEAL_PREFERENCES)[number];

export const ROOM_OCCUPANCIES = ["single", "double", "triple", "quad"] as const;
export type RoomOccupancy = (typeof ROOM_OCCUPANCIES)[number];

/**
 * Client vocabulary (api/migrations/009_client_vocab_patch.sql) is Budget /
 * 2-Star / 3-Star / 4-Star / 5-Star. "luxury" is kept for legacy package rate
 * cards priced before that patch landed.
 */
export const HOTEL_CATEGORIES = ["budget", "2star", "3star", "4star", "5star", "luxury"] as const;
export type HotelCategory = (typeof HOTEL_CATEGORIES)[number];

export const HOTEL_CATEGORY_LABELS: Record<HotelCategory, string> = {
  budget: "Budget",
  "2star": "2-Star",
  "3star": "3-Star",
  "4star": "4-Star",
  "5star": "5-Star",
  luxury: "Luxury",
};

/** Mirrors Booking::TRANSITIONS — the UI only offers moves the API will accept. */
export const BOOKING_TRANSITIONS: Record<BookingStatus, readonly BookingStatus[]> = {
  draft: ["confirmed", "cancelled"],
  confirmed: ["vouchered", "in_progress", "cancelled"],
  vouchered: ["in_progress", "cancelled"],
  in_progress: ["completed", "no_show", "cancelled"],
  completed: [],
  cancelled: [],
  no_show: ["completed"],
};

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

export interface Booking {
  id: number;
  booking_no: string;
  quotation_id: number | null;
  lead_id: number | null;
  customer_id: number;
  agency_id: number | null;
  package_id: number | null;
  departure_id: number | null;
  destination_id: number | null;
  booking_type: BookingType;
  booking_date: ISODate;
  travel_from: ISODate;
  travel_to: ISODate;
  nights: number;
  adults: number;
  children: number;
  infants: number;
  hotel_category: HotelCategory | null;
  lead_pax_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  emergency_contact: string | null;
  emergency_phone: string | null;
  currency: string;
  subtotal: Decimal;
  discount_amount: Decimal;
  taxable_amount: Decimal;
  gst_pct: Decimal;
  gst_amount: Decimal;
  tcs_amount: Decimal;
  grand_total: Decimal;
  /** Stripped by the API for roles without `view_costs`. */
  cost_total?: Decimal;
  agency_commission: Decimal;
  amount_paid: Decimal;
  last_payment_at: ISODateTime | null;
  payment_status: BookingPaymentStatus;
  status: BookingStatus;
  previous_status: string | null;
  confirmed_at: ISODateTime | null;
  completed_at: ISODateTime | null;
  cancelled_at: ISODateTime | null;
  cancelled_by: number | null;
  cancellation_reason: string | null;
  cancellation_charge: Decimal;
  refund_amount: Decimal;
  special_requests: string | null;
  internal_notes: string | null;
  owner_id: number | null;
  ops_owner_id: number | null;
  created_at: ISODateTime;
  updated_at: ISODateTime;
  created_by: number | null;
  /** Always computed at read time, never stored. */
  outstanding: Decimal;
}

export interface BookingListItem extends Booking {
  customer_name: string | null;
  customer_phone: string | null;
  destination_name: string | null;
  package_name: string | null;
  batch_code: string | null;
  agency_name: string | null;
  owner_name: string | null;
  ops_owner_name: string | null;
  days_to_departure: number | null;
  pending_services: number;
}

export interface BookingPax {
  id: number;
  booking_id: number;
  pax_no: number;
  title: PaxTitle;
  first_name: string;
  last_name: string | null;
  pax_type: PaxType;
  gender: Gender | null;
  date_of_birth: ISODate | null;
  age: number | null;
  nationality_id: number | null;
  phone: string | null;
  email: string | null;
  passport_no: string | null;
  passport_issue: ISODate | null;
  passport_expiry: ISODate | null;
  passport_country: string | null;
  visa_no: string | null;
  visa_status: VisaStatus;
  visa_expiry: ISODate | null;
  meal_preference: MealPreference;
  medical_notes: string | null;
  is_lead_pax: Flag;
  insurance_no: string | null;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

export interface BookingService {
  id: number;
  booking_id: number;
  service_type: ServiceType;
  ref_id: number | null;
  supplier_id: number | null;
  description: string;
  day_no: number | null;
  service_date: ISODate | null;
  service_end_date: ISODate | null;
  city_id: number | null;
  quantity: Decimal;
  unit: string;
  nights: number;
  pax_count: number;
  /** Stripped for roles without `view_costs`. */
  unit_cost?: Decimal;
  unit_price: Decimal;
  /** Stripped for roles without `view_costs`. */
  cost_total?: Decimal;
  sell_total: Decimal;
  tax_pct: Decimal;
  currency: string;
  fx_rate: Decimal;
  confirmation_no: string | null;
  supplier_status: SupplierStatus;
  confirmed_at: ISODateTime | null;
  voucher_sent_at: ISODateTime | null;
  supplier_bill_id: number | null;
  notes: string | null;
  sort_order: number;
  created_at: ISODateTime;
  updated_at: ISODateTime;
  created_by: number | null;
  supplier_name: string | null;
  city_name: string | null;
}

export interface BookingRoom {
  id: number;
  booking_id: number;
  booking_service_id: number | null;
  room_no: number;
  room_type_id: number | null;
  room_type_label: string | null;
  occupancy: RoomOccupancy;
  extra_bed: number;
  /** Comma-separated booking_pax ids. */
  pax_ids: string | null;
  hotel_room_no: string | null;
  notes: string | null;
}

export interface BookingInvoiceRef {
  id: number;
  invoice_no: string;
  invoice_date: ISODate;
  grand_total: Decimal;
  amount_paid: Decimal;
  payment_status: string;
  status: string;
}

export interface BookingVoucherRef {
  id: number;
  voucher_no: string;
  voucher_type: string;
  status: string;
  issued_at: ISODateTime | null;
  valid_from: ISODate | null;
  valid_to: ISODate | null;
}

export interface BookingTripAssignmentRef {
  id: number;
  booking_id: number;
  booking_service_id: number | null;
  vehicle_id: number | null;
  driver_id: number | null;
  guide_id: number | null;
  guide_source: "staff" | "supplier";
  supplier_id: number | null;
  from_date: ISODate;
  to_date: ISODate;
  pickup_point: string | null;
  pickup_time: string | null;
  drop_point: string | null;
  route_summary: string | null;
  estimated_km: number;
  status: string;
  driver_notified_at: ISODateTime | null;
  notes: string | null;
  registration_no: string | null;
  vehicle_type_name: string | null;
  driver_name: string | null;
  driver_phone: string | null;
}

/** Per-booking P&L. Only returned to roles with `view_costs`. */
export interface BookingMargin {
  revenue: number;
  estimated_cost: number;
  billed_cost: number;
  direct_expenses: number;
  actual_cost: number;
  commission: number;
  margin: number;
  margin_pct: number;
  /** True while nothing has been billed by a supplier — margin is a forecast. */
  is_estimated: boolean;
}

export interface BookingDetail extends Booking {
  customer_name: string | null;
  customer_phone: string | null;
  customer_email: string | null;
  customer_address: string | null;
  customer_city: string | null;
  customer_state: string | null;
  customer_gstin: string | null;
  customer_code: string | null;
  destination_name: string | null;
  package_name: string | null;
  package_code: string | null;
  batch_code: string | null;
  departure_date: ISODate | null;
  agency_name: string | null;
  owner_name: string | null;
  ops_owner_name: string | null;
  quote_no: string | null;
  pax: BookingPax[];
  services: BookingService[];
  rooms: BookingRoom[];
  payments: Payment[];
  invoices: BookingInvoiceRef[];
  vouchers: BookingVoucherRef[];
  trip_assignments: BookingTripAssignmentRef[];
  /** Absent for roles without `view_costs`. */
  margin?: BookingMargin;
  /** The toggle set carried over from the quotation (or set directly). */
  options?: BookingOptions;
  /** Real flight/train/bus numbers, PNR and timings for the itinerary handout. */
  travel_legs?: TravelLeg[];
}

export interface PaxWarning {
  pax_no: number;
  severity: Severity;
  message: string;
}

export interface SavePaxResult {
  pax: BookingPax[];
  warnings: PaxWarning[];
}

export interface CancellationPolicyPreview {
  days_before: number;
  charge: number;
  refund: number;
  label: string;
  policy_id?: number;
}

export interface CancelBookingResult {
  booking: BookingDetail;
  policy: CancellationPolicyPreview;
  /** Capped at what was actually received, so it can be below policy refund. */
  refund_due: number;
}

export interface WorkflowTransition {
  id: number;
  entity_type: string;
  entity_id: number;
  from_status: string | null;
  to_status: string;
  note: string | null;
  actor_id: number | null;
  created_at: ISODateTime;
  actor_name: string | null;
}

export interface AuditEntry {
  id: number;
  user_id: number | null;
  action: string;
  entity_type: string | null;
  entity_id: number | null;
  old_value: string | null;
  new_value: string | null;
  note: string | null;
  ip_address: string | null;
  created_at: ISODateTime;
  actor_name?: string | null;
}

export interface BookingHistory {
  transitions: WorkflowTransition[];
  audit: AuditEntry[];
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export type BookingFilters = {
  page?: number;
  limit?: number;
  search?: string;
  sort?: string;
  dir?: SortDir;
  status?: BookingStatus | readonly BookingStatus[];
  payment_status?: BookingPaymentStatus;
  customer_id?: number;
  package_id?: number;
  departure_id?: number;
  destination_id?: number;
  owner_id?: number;
  travel_from?: ISODate;
  travel_to?: ISODate;
  booked_from?: ISODate;
  booked_to?: ISODate;
  outstanding_only?: boolean;
  departing_within_days?: number;
};

export interface BookingInput {
  customer_id: number;
  quotation_id?: number | null;
  lead_id?: number | null;
  agency_id?: number | null;
  package_id?: number | null;
  departure_id?: number | null;
  destination_id?: number | null;
  booking_type?: BookingType;
  travel_from: ISODate;
  travel_to: ISODate;
  adults: number;
  children?: number;
  infants?: number;
  hotel_category?: HotelCategory | null;
  lead_pax_name?: string | null;
  contact_phone?: string | null;
  contact_email?: string | null;
  emergency_contact?: string | null;
  emergency_phone?: string | null;
  special_requests?: string | null;
  internal_notes?: string | null;
  owner_id?: number | null;
  ops_owner_id?: number | null;
}

export type BookingUpdateInput = Partial<Omit<BookingInput, "customer_id" | "quotation_id" | "lead_id">>;

/** One editable service line. Totals are derived server-side from qty × unit. */
export interface BookingServiceInput {
  service_type: ServiceType;
  description: string;
  ref_id?: number | null;
  supplier_id?: number | null;
  day_no?: number | null;
  service_date?: ISODate | null;
  service_end_date?: ISODate | null;
  city_id?: number | null;
  quantity: number;
  unit?: string;
  nights?: number;
  pax_count?: number;
  unit_cost?: number;
  unit_price: number;
  tax_pct?: number;
  currency?: string;
  fx_rate?: number;
  notes?: string | null;
}

export interface SaveServicesInput {
  services: BookingServiceInput[];
  /** Only roles with `edit_prices` may change this. */
  discount_amount?: number;
}

export interface PriceFromPackageInput {
  occupancy?: "single" | "double" | "triple";
  children_with_bed?: number;
  children_no_bed?: number;
  extra_beds?: number;
}

export interface BookingPaxInput {
  title?: PaxTitle;
  first_name: string;
  last_name?: string | null;
  pax_type?: PaxType;
  gender?: Gender | null;
  date_of_birth?: ISODate | null;
  age?: number | null;
  nationality_id?: number | null;
  phone?: string | null;
  email?: string | null;
  passport_no?: string | null;
  passport_issue?: ISODate | null;
  passport_expiry?: ISODate | null;
  passport_country?: string | null;
  visa_no?: string | null;
  visa_status?: VisaStatus;
  visa_expiry?: ISODate | null;
  meal_preference?: MealPreference;
  medical_notes?: string | null;
  is_lead_pax?: boolean;
  insurance_no?: string | null;
}

// ---------------------------------------------------------------------------
// Calls
// ---------------------------------------------------------------------------

export async function listBookings(params: BookingFilters = {}) {
  return apiList<BookingListItem>(`/bookings${buildQuery(params)}`);
}

export async function getBooking(id: number) {
  return apiGet<BookingDetail>(`/bookings/${id}`);
}

export async function createBooking(input: BookingInput) {
  return apiPost<BookingDetail>("/bookings", input);
}

export async function updateBooking(id: number, input: BookingUpdateInput) {
  return apiPut<BookingDetail>(`/bookings/${id}`, input);
}

/** Replaces every service line and recomputes the money block. */
export async function saveBookingServices(id: number, input: SaveServicesInput) {
  return apiPut<BookingDetail>(`/bookings/${id}/services`, input);
}

export async function priceBookingFromPackage(id: number, input: PriceFromPackageInput = {}) {
  return apiPost<BookingDetail>(`/bookings/${id}/services/from-package`, input);
}

export async function saveBookingPax(id: number, pax: BookingPaxInput[]) {
  return apiPut<SavePaxResult>(`/bookings/${id}/pax`, { pax });
}

export async function confirmBooking(id: number, note?: string) {
  return apiPost<BookingDetail>(`/bookings/${id}/confirm`, { note: note ?? null });
}

export async function changeBookingStatus(id: number, status: BookingStatus, note?: string) {
  return apiPost<BookingDetail>(`/bookings/${id}/status`, { status, note: note ?? null });
}

export async function cancelBooking(id: number, reason: string) {
  return apiPost<CancelBookingResult>(`/bookings/${id}/cancel`, { reason });
}

export async function getBookingMargin(id: number) {
  return apiGet<BookingMargin>(`/bookings/${id}/margin`);
}

export async function getBookingHistory(id: number) {
  return apiGet<BookingHistory>(`/bookings/${id}/history`);
}
