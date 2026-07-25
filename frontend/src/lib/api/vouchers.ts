import { apiGet, apiList, apiPost, buildQuery } from "@/lib/api/client";
import type { Flag, ISODate, ISODateTime, SortDir } from "@/lib/api/common";
import type { ServiceType } from "@/lib/api/bookings";

/**
 * Guest-facing vouchers. A voucher is a SNAPSHOT: `content` freezes the
 * booking, passenger list, service line and supplier at the moment of issue
 * (see Voucher::snapshot server-side), so a later itinerary edit can never
 * rewrite a document the guest is already holding. Vouchers are cancelled,
 * never deleted.
 */

export const VOUCHER_TYPES = ["hotel", "transport", "activity", "flight", "tour", "visa", "insurance"] as const;
export type VoucherType = (typeof VOUCHER_TYPES)[number];

export const VOUCHER_STATUSES = ["draft", "issued", "sent", "cancelled"] as const;
export type VoucherStatus = (typeof VOUCHER_STATUSES)[number];

/** A voucher may still be presented to a supplier in either of these states. */
export const VOUCHER_LIVE_STATUSES: readonly VoucherStatus[] = ["issued", "sent"];

export interface Voucher {
  id: number;
  voucher_no: string;
  booking_id: number;
  booking_service_id: number | null;
  voucher_type: VoucherType;
  supplier_id: number | null;
  issued_to: string | null;
  valid_from: ISODate | null;
  valid_to: ISODate | null;
  file_path: string | null;
  status: VoucherStatus;
  issued_at: ISODateTime | null;
  sent_at: ISODateTime | null;
  cancelled_at: ISODateTime | null;
  created_at: ISODateTime;
  created_by: number | null;
}

export interface VoucherListItem extends Voucher {
  booking_no: string;
  travel_from: ISODate;
  travel_to: ISODate;
  booking_status: string;
  customer_name: string | null;
  customer_phone: string | null;
  supplier_name: string | null;
  supplier_phone: string | null;
  service_description: string | null;
  confirmation_no: string | null;
  issued_by_name: string | null;
}

export interface VoucherContentPax {
  pax_no: number;
  title: string;
  first_name: string;
  last_name: string | null;
  pax_type: string;
  gender: string | null;
  age: number | null;
  passport_no: string | null;
  passport_expiry: ISODate | null;
  visa_no: string | null;
  visa_status: string | null;
  meal_preference: string | null;
  is_lead_pax: Flag;
}

/** The frozen snapshot rendered onto the printed/PDF voucher. */
export interface VoucherContent {
  voucher_no: string;
  voucher_type: VoucherType;
  generated_at: ISODateTime;
  generated_by: number | null;
  company: Record<string, unknown>;
  booking: {
    booking_no: string;
    booking_date: ISODate;
    travel_from: ISODate;
    travel_to: ISODate;
    nights: number;
    adults: number;
    children: number;
    infants: number;
    lead_pax_name: string | null;
    contact_phone: string | null;
    contact_email: string | null;
    emergency_contact: string | null;
    emergency_phone: string | null;
    special_requests: string | null;
    currency: string;
  };
  customer: { code: string; full_name: string; phone: string | null; email: string | null; city: string | null; state: string | null } | null;
  pax: VoucherContentPax[];
  service?: {
    id: number;
    service_type: ServiceType;
    description: string;
    day_no: number | null;
    service_date: ISODate | null;
    service_end_date: ISODate | null;
    city_name: string | null;
    nights: number;
    pax_count: number;
    quantity: number;
    unit: string;
    confirmation_no: string | null;
    supplier_status: string;
    notes: string | null;
  } | null;
  supplier?: {
    id: number;
    name: string;
    contact_person: string | null;
    phone: string | null;
    alt_phone: string | null;
    email: string | null;
    address: string | null;
  } | null;
  rooms?: { room_no: string | null; room_type_label: string | null; occupancy: string | null; extra_bed: Flag; pax_ids: string | null; notes: string | null }[];
  itinerary?: {
    service_type: ServiceType;
    description: string;
    day_no: number | null;
    service_date: ISODate | null;
    service_end_date: ISODate | null;
    confirmation_no: string | null;
    supplier_status: string;
    supplier_name: string | null;
    city_name: string | null;
  }[];
}

export interface VoucherDetail extends Voucher {
  booking_no: string;
  travel_from: ISODate;
  travel_to: ISODate;
  booking_status: string;
  agency_id: number | null;
  adults: number;
  children: number;
  infants: number;
  contact_phone: string | null;
  contact_email: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_email: string | null;
  supplier_name: string | null;
  supplier_phone: string | null;
  supplier_address: string | null;
  service_description: string | null;
  confirmation_no: string | null;
  supplier_status: string | null;
  issued_by_name: string | null;
  content: VoucherContent | null;
}

export interface VoucherForBooking {
  id: number;
  voucher_no: string;
  booking_service_id: number | null;
  voucher_type: VoucherType;
  supplier_id: number | null;
  issued_to: string | null;
  valid_from: ISODate | null;
  valid_to: ISODate | null;
  status: VoucherStatus;
  issued_at: ISODateTime | null;
  sent_at: ISODateTime | null;
  cancelled_at: ISODateTime | null;
  supplier_name: string | null;
  service_description: string | null;
}

export interface PendingVoucherService {
  id: number;
  service_type: ServiceType;
  description: string;
  service_date: ISODate | null;
  service_end_date: ISODate | null;
  supplier_id: number | null;
  confirmation_no: string | null;
  supplier_name: string | null;
}

export interface BookingVouchers {
  vouchers: VoucherForBooking[];
  pending_services: PendingVoucherService[];
}

export type VoucherFilters = {
  page?: number;
  limit?: number;
  search?: string;
  sort?: string;
  dir?: SortDir;
  booking_id?: number;
  voucher_type?: VoucherType;
  supplier_id?: number;
  status?: VoucherStatus | VoucherStatus[];
  from?: ISODate;
  to?: ISODate;
  format?: "csv";
};

export interface IssueVoucherInput {
  voucher_type?: VoucherType;
  booking_service_id?: number;
}

export interface IssueAllSkipped {
  booking_service_id: number;
  description: string;
  reason: string;
}

export interface IssueAllResult {
  issued: Voucher[];
  skipped: IssueAllSkipped[];
  vouchers: VoucherForBooking[];
}

export async function listVouchers(params: VoucherFilters = {}) {
  return apiList<VoucherListItem>(`/vouchers${buildQuery(params)}`);
}

export async function getVoucher(id: number) {
  return apiGet<VoucherDetail>(`/vouchers/${id}`);
}

export async function getBookingVouchers(bookingId: number) {
  return apiGet<BookingVouchers>(`/bookings/${bookingId}/vouchers`);
}

export async function issueVoucher(bookingId: number, input: IssueVoucherInput) {
  return apiPost<VoucherDetail>(`/bookings/${bookingId}/vouchers`, input);
}

/** One voucher per confirmed supplier service that does not already have one. */
export async function issueAllVouchers(bookingId: number) {
  return apiPost<IssueAllResult>(`/bookings/${bookingId}/vouchers/issue-all`);
}

export async function cancelVoucher(id: number, reason: string) {
  return apiPost<VoucherDetail>(`/vouchers/${id}/cancel`, { reason });
}

/** Records that the guest has received the voucher. */
export async function markVoucherSent(id: number) {
  return apiPost<VoucherDetail>(`/vouchers/${id}/send`);
}
